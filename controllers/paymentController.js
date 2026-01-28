const paypalService = require('../Services/paypal');
const netsService = require('../Services/nets');
const stripeService = require('../Services/stripe');

const createPaymentController = ({ connection, getCartForCheckout, createOrderFromCart }) => {
    const loadCartSummary = (userId) =>
        getCartForCheckout(userId).then((items) => {
            if (!items.length) {
                throw new Error('Your cart is empty.');
            }
            const total = items.reduce((acc, item) => acc + Number(item.price) * Number(item.quantity || 0), 0);
            return { items, total: Number(total.toFixed(2)) };
        });

    const logPaymentEvent = ({ orderId = null, provider, eventType, status, message = null, payload = null }) => {
        const sql = `
            INSERT INTO payment_events (order_id, provider, event_type, status, message, payload)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const safePayload = payload ? JSON.stringify(payload) : null;
        connection.query(sql, [orderId, provider, eventType, status, message, safePayload], (error) => {
            if (error) {
                console.error('Unable to log payment event:', error);
            }
        });
    };

    const createPaypalOrder = async (req, res) => {
        try {
            const userId = req.session.user.id;
            const { total } = await loadCartSummary(userId);
            const order = await paypalService.createOrder(total);

            if (!order || !order.id) {
                return res.status(500).json({ error: 'Unable to start PayPal checkout.' });
            }

            res.json({ id: order.id });
        } catch (error) {
            console.error('Unable to start PayPal checkout:', error);
            res.status(500).json({ error: error.message || 'Unable to start PayPal checkout.' });
        }
    };

    const capturePaypalOrder = async (req, res) => {
        const { orderId } = req.body || {};
        if (!orderId) {
            return res.status(400).json({ error: 'Missing PayPal order id.' });
        }

        try {
            const capture = await paypalService.captureOrder(orderId);
            const status = capture?.status;

            if (status !== 'COMPLETED') {
                logPaymentEvent({
                    provider: 'paypal',
                    eventType: 'capture.not_completed',
                    status: 'failed',
                    message: 'PayPal payment was not completed.',
                    payload: capture
                });
                return res.json({
                    redirectUrl: '/checkout/failure?method=paypal&reason=not_completed'
                });
            }

            const captureId = capture?.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;
            const dbOrderId = await createOrderFromCart(req.session.user.id, 'paypal', 'paid', captureId);
            logPaymentEvent({
                orderId: dbOrderId,
                provider: 'paypal',
                eventType: 'capture.completed',
                status: 'paid',
                message: 'PayPal capture completed.',
                payload: capture
            });
            res.json({ redirectUrl: `/checkout/loading?orderId=${dbOrderId}&method=paypal` });
        } catch (error) {
            console.error('Unable to capture PayPal order:', error);
            logPaymentEvent({
                provider: 'paypal',
                eventType: 'capture.error',
                status: 'failed',
                message: error.message || 'PayPal capture failed.'
            });
            res.status(500).json({
                error: error.message || 'Unable to capture PayPal payment.',
                redirectUrl: '/checkout/failure?method=paypal&reason=error'
            });
        }
    };

    const startNetsPayment = async (req, res) => {
        try {
            const userId = req.session.user.id;
            const { total } = await loadCartSummary(userId);

            req.body = { ...req.body, cartTotal: total.toFixed(2) };
            return netsService.generateQrCode(req, res);
        } catch (error) {
            console.error('Unable to start NETS payment:', error);
            req.flash('error', 'Unable to start NETS payment right now.');
            return res.redirect('/checkout');
        }
    };

    const finishNetsPayment = (req, res) => {
        const txnRetrievalRef = req.query.txn_retrieval_ref || req.body?.txn_retrieval_ref;
        const netsPayment = req.session.netsPayment;

        if (
            !netsPayment ||
            netsPayment.status !== 'success' ||
            (txnRetrievalRef && netsPayment.txnRetrievalRef !== txnRetrievalRef)
        ) {
            return res.redirect('/checkout/failure?method=nets&reason=not_completed');
        }

        const paymentReference = netsPayment?.txnRetrievalRef || null;
        createOrderFromCart(req.session.user.id, 'nets', 'paid', paymentReference)
            .then((orderId) => {
                req.session.netsPayment = null;
                logPaymentEvent({
                    orderId,
                    provider: 'nets',
                    eventType: 'payment.completed',
                    status: 'paid',
                    message: 'NETS payment completed.'
                });
                res.redirect(`/checkout/loading?orderId=${orderId}&method=nets`);
            })
            .catch((error) => {
                console.error('Unable to finalize NETS order:', error);
                logPaymentEvent({
                    provider: 'nets',
                    eventType: 'payment.error',
                    status: 'failed',
                    message: error.message || 'NETS payment failed.'
                });
                req.flash('error', error.message || 'Unable to finalize payment.');
                res.redirect('/checkout/failure?method=nets&reason=error');
            });
    };

    const renderNetsFailure = (req, res) => {
        const reason = req.query.reason || '';
        let errorMsg = 'NETS payment was not completed.';
        if (reason === 'timeout') {
            errorMsg = 'NETS payment timed out. Your cart is unchanged.';
        } else if (reason === 'error') {
            errorMsg = 'Unable to verify NETS payment. Your cart is unchanged.';
        } else if (reason === 'cancelled') {
            errorMsg = 'NETS payment was cancelled. Your cart is unchanged.';
        }

        req.session.netsPayment = null;
        res.status(402).render('paymentFail', {
            title: 'Payment Unsuccessful',
            user: req.session.user,
            method: 'nets',
            reason,
            responseCode: 'N.A.',
            instructions: '',
            errorMsg
        });
    };

    const streamNetsStatus = (req, res) => {
        res.set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
        });

        const txnRetrievalRef = req.params.txnRetrievalRef;
        if (!txnRetrievalRef) {
            res.write(`data: ${JSON.stringify({ error: 'Missing transaction reference.' })}\n\n`);
            return res.end();
        }

        let pollCount = 0;
        const maxPolls = 60;
        let frontendTimeoutStatus = 0;
        let ended = false;

        const poll = async () => {
            if (ended) return;
            pollCount += 1;

            try {
                const response = await fetch(
                    'https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/query',
                    {
                        method: 'POST',
                        headers: {
                            'api-key': process.env.API_KEY,
                            'project-id': process.env.PROJECT_ID,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            txn_retrieval_ref: txnRetrievalRef,
                            frontend_timeout_status: frontendTimeoutStatus
                        })
                    }
                );

                const data = await response.json();
                res.write(`data: ${JSON.stringify(data)}\n\n`);

                const resData = data?.result?.data;
                if (resData?.response_code === '00' && resData?.txn_status === 1) {
                    req.session.netsPayment = { status: 'success', txnRetrievalRef };
                    req.session.save(() => {
                        if (ended) return;
                        res.write(`data: ${JSON.stringify({ success: true })}\n\n`);
                        clearInterval(interval);
                        ended = true;
                        res.end();
                    });
                    return;
                }

                if (
                    frontendTimeoutStatus === 1 &&
                    resData &&
                    (resData.response_code !== '00' || resData.txn_status === 2)
                ) {
                    req.session.netsPayment = { status: 'fail', txnRetrievalRef };
                    req.session.save(() => {
                        if (ended) return;
                        res.write(`data: ${JSON.stringify({ fail: true, ...resData })}\n\n`);
                        clearInterval(interval);
                        ended = true;
                        res.end();
                    });
                    return;
                }
            } catch (error) {
                if (ended) return;
                clearInterval(interval);
                ended = true;
                res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
                return res.end();
            }

            if (pollCount >= maxPolls) {
                frontendTimeoutStatus = 1;
                req.session.netsPayment = { status: 'fail', txnRetrievalRef };
                req.session.save(() => {
                    if (ended) return;
                    res.write(`data: ${JSON.stringify({ fail: true, error: 'Timeout' })}\n\n`);
                    clearInterval(interval);
                    ended = true;
                    res.end();
                });
            }
        };

        const interval = setInterval(poll, 5000);
        poll();

        req.on('close', () => {
            clearInterval(interval);
        });
    };

    const updateOrderStatusByReference = (paymentReference, nextStatus) =>
        new Promise((resolve, reject) => {
            if (!paymentReference) return resolve(false);
            const sql = `
                UPDATE orders
                SET status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE payment_reference = ?
            `;
            connection.query(sql, [nextStatus, paymentReference], (error, result) => {
                if (error) return reject(error);
                const updated = result?.affectedRows > 0;
                if (updated) {
                    logPaymentEvent({
                        provider: 'webhook',
                        eventType: 'status.updated',
                        status: nextStatus,
                        message: `Order status updated via webhook for ${paymentReference}.`
                    });
                }
                resolve(updated);
            });
        });

    const updateOrderStatusByStripeRef = (stripeRef, nextStatus) =>
        new Promise((resolve, reject) => {
            if (!stripeRef) return resolve(false);
            const likeRef = `%:${stripeRef}`;
            const sql = `
                UPDATE orders
                SET status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE payment_reference = ? OR payment_reference LIKE ?
            `;
            connection.query(sql, [nextStatus, stripeRef, likeRef], (error, result) => {
                if (error) return reject(error);
                const updated = result?.affectedRows > 0;
                if (updated) {
                    logPaymentEvent({
                        provider: 'webhook',
                        eventType: 'status.updated',
                        status: nextStatus,
                        message: `Order status updated via Stripe webhook for ${stripeRef}.`
                    });
                }
                resolve(updated);
            });
        });

    const handlePaypalWebhook = async (req, res) => {
        const event = req.body || {};
        const eventType = event.event_type || '';
        const resource = event.resource || {};

        let paymentReference = null;
        if (resource.id) paymentReference = resource.id;
        if (!paymentReference && resource?.supplementary_data?.related_ids?.capture_id) {
            paymentReference = resource.supplementary_data.related_ids.capture_id;
        }

        try {
            if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
                await updateOrderStatusByReference(paymentReference, 'paid');
                logPaymentEvent({
                    provider: 'paypal',
                    eventType: eventType.toLowerCase(),
                    status: 'paid',
                    payload: event
                });
            } else if (eventType === 'PAYMENT.CAPTURE.DENIED' || eventType === 'PAYMENT.CAPTURE.REVERSED') {
                await updateOrderStatusByReference(paymentReference, 'failed');
                logPaymentEvent({
                    provider: 'paypal',
                    eventType: eventType.toLowerCase(),
                    status: 'failed',
                    payload: event
                });
            } else {
                logPaymentEvent({
                    provider: 'paypal',
                    eventType: (eventType || 'unknown').toLowerCase(),
                    status: 'ignored',
                    payload: event
                });
            }
        } catch (error) {
            console.error('PayPal webhook error:', error);
        }

        return res.status(200).json({ received: true });
    };

    const handleNetsWebhook = async (req, res) => {
        const payload = req.body || {};
        const reference =
            payload.txn_retrieval_ref ||
            payload.txnRetrievalRef ||
            payload?.data?.txn_retrieval_ref ||
            payload?.result?.data?.txn_retrieval_ref ||
            null;

        const status =
            payload.txn_status ??
            payload?.data?.txn_status ??
            payload?.result?.data?.txn_status ??
            null;

        try {
            if (status === 1) {
                await updateOrderStatusByReference(reference, 'paid');
                logPaymentEvent({
                    provider: 'nets',
                    eventType: 'webhook.paid',
                    status: 'paid',
                    payload
                });
            } else if (status === 2) {
                await updateOrderStatusByReference(reference, 'failed');
                logPaymentEvent({
                    provider: 'nets',
                    eventType: 'webhook.failed',
                    status: 'failed',
                    payload
                });
            } else {
                logPaymentEvent({
                    provider: 'nets',
                    eventType: 'webhook.ignored',
                    status: 'ignored',
                    payload
                });
            }
        } catch (error) {
            console.error('NETS webhook error:', error);
        }

        return res.status(200).json({ received: true });
    };

    const handleStripeWebhook = async (req, res) => {
        const signature = req.headers['stripe-signature'];
        let event;

        try {
            event = stripeService.constructWebhookEvent({
                payload: req.body,
                signature,
                secret: process.env.STRIPE_WEBHOOK_SECRET
            });
        } catch (error) {
            console.error('Stripe webhook signature error:', error.message || error);
            return res.status(400).send(`Webhook Error: ${error.message || 'Invalid signature'}`);
        }

        const eventType = event.type || 'unknown';
        const data = event.data?.object || {};
        const paymentIntentId = data?.payment_intent || data?.id || null;
        const chargeId = data?.charge || data?.latest_charge || null;

        try {
            if (eventType === 'payment_intent.succeeded') {
                await updateOrderStatusByStripeRef(paymentIntentId, 'paid');
                logPaymentEvent({
                    provider: 'stripe',
                    eventType,
                    status: 'paid',
                    message: 'Stripe payment intent succeeded.',
                    payload: data
                });
            } else if (eventType === 'payment_intent.payment_failed') {
                await updateOrderStatusByStripeRef(paymentIntentId, 'failed');
                logPaymentEvent({
                    provider: 'stripe',
                    eventType,
                    status: 'failed',
                    message: 'Stripe payment intent failed.',
                    payload: data
                });
            } else if (eventType === 'charge.refunded') {
                await updateOrderStatusByStripeRef(chargeId, 'refunded');
                logPaymentEvent({
                    provider: 'stripe',
                    eventType,
                    status: 'refunded',
                    message: 'Stripe charge refunded.',
                    payload: data
                });
            } else {
                logPaymentEvent({
                    provider: 'stripe',
                    eventType,
                    status: 'ignored',
                    payload: data
                });
            }
        } catch (error) {
            console.error('Stripe webhook error:', error);
        }

        return res.status(200).json({ received: true });
    };

    const renderPaymentFailure = (req, res) => {
        const method = String(req.query.method || '').toLowerCase();
        const reason = String(req.query.reason || '').toLowerCase();
        res.status(402).render('paymentFail', {
            title: 'Payment Unsuccessful',
            user: req.session.user,
            method,
            reason,
            responseCode: req.query.code || '',
            instructions: req.query.instructions || '',
            errorMsg: req.query.message ? decodeURIComponent(String(req.query.message)) : ''
        });
    };

    const renderPaymentLoading = (req, res) => {
        const orderId = parseInt(req.query.orderId, 10);
        const method = String(req.query.method || '').toLowerCase();
        if (!Number.isInteger(orderId)) {
            req.flash('error', 'Missing order details for payment confirmation.');
            return res.redirect('/orders');
        }

        return res.render('paymentLoading', {
            title: 'Processing Payment',
            user: req.session.user,
            orderId,
            method
        });
    };


    return {
        createPaypalOrder,
        capturePaypalOrder,
        startNetsPayment,
        finishNetsPayment,
        renderNetsFailure,
        streamNetsStatus,
        handlePaypalWebhook,
        handleNetsWebhook,
        handleStripeWebhook,
        renderPaymentFailure,
        renderPaymentLoading
    };
};

module.exports = createPaymentController;
