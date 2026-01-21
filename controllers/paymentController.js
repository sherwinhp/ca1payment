const paypalService = require('../Services/paypal');
const netsService = require('../Services/nets');

const createPaymentController = ({ connection, getCartForCheckout, createOrderFromCart }) => {
    const loadCartSummary = (userId) =>
        getCartForCheckout(userId).then((items) => {
            if (!items.length) {
                throw new Error('Your cart is empty.');
            }
            const total = items.reduce((acc, item) => acc + Number(item.price) * Number(item.quantity || 0), 0);
            return { items, total: Number(total.toFixed(2)) };
        });

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
                return res.status(400).json({ error: 'PayPal payment was not completed.' });
            }

            const dbOrderId = await createOrderFromCart(req.session.user.id, 'paypal');
            res.json({ redirectUrl: `/orders/${dbOrderId}/invoice` });
        } catch (error) {
            console.error('Unable to capture PayPal order:', error);
            res.status(500).json({ error: error.message || 'Unable to capture PayPal payment.' });
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
            return res.redirect('/payments/nets/fail?reason=not_completed');
        }

        createOrderFromCart(req.session.user.id, 'nets')
            .then((orderId) => {
                req.session.netsPayment = null;
                res.redirect(`/orders/${orderId}/invoice`);
            })
            .catch((error) => {
                console.error('Unable to finalize NETS order:', error);
                req.flash('error', error.message || 'Unable to finalize payment.');
                res.redirect('/checkout');
            });
    };

    const renderNetsFailure = (req, res) => {
        const reason = req.query.reason || '';
        let errorMsg = 'NETS payment was not completed.';
        if (reason === 'timeout') {
            errorMsg = 'NETS payment timed out. Please try again.';
        } else if (reason === 'error') {
            errorMsg = 'Unable to verify NETS payment. Please try again.';
        }

        req.session.netsPayment = null;
        res.status(402).render('netsQrFail', {
            title: 'NETS Payment Error',
            user: req.session.user,
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

    return {
        createPaypalOrder,
        capturePaypalOrder,
        startNetsPayment,
        finishNetsPayment,
        renderNetsFailure,
        streamNetsStatus
    };
};

module.exports = createPaymentController;
