const createRefundController = ({ connection }) => {
    const renderRefundForm = (req, res) => {
        const orderId = parseInt(req.params.id, 10);
        const userId = req.session.user.id;

        if (!Number.isInteger(orderId)) {
            req.flash('error', 'Invalid order selected.');
            return res.redirect('/orders');
        }

        const orderSQL = `
            SELECT
                o.id,
                o.total_amount,
                o.payment_method,
                o.status,
                rr.id AS refund_id,
                rr.status AS refund_status,
                rr.admin_note AS refund_admin_note,
                rr.requested_amount,
                rr.approved_amount
            FROM orders o
            LEFT JOIN refund_requests rr ON rr.order_id = o.id
            WHERE o.id = ? AND o.user_id = ?
        `;

        connection.query(orderSQL, [orderId, userId], (error, rows = []) => {
            if (error || !rows.length) {
                if (error) {
                    console.error('Unable to load refund form:', error);
                }
                req.flash('error', 'Order not found.');
                return res.redirect('/orders');
            }

            const order = rows[0];
            const canRequest = order.status === 'paid';

            res.render('refundRequest', {
                user: req.session.user,
                order,
                canRequest,
                messages: {
                    error: req.flash('error'),
                    success: req.flash('success')
                }
            });
        });
    };

    const submitRefundRequest = (req, res) => {
        const orderId = parseInt(req.params.id, 10);
        const userId = req.session.user.id;
        const reasonCode = String(req.body.refundReason || 'other').trim().toLowerCase();
        const reasonDetails = (req.body.reasonDetails || '').trim();
        const imagePath = req.file ? `/uploads/refunds/${req.file.filename}` : null;
        const requestedAmountRaw = String(req.body.requestedAmount || '').trim();

        if (!Number.isInteger(orderId)) {
            req.flash('error', 'Invalid order selected.');
            return res.redirect('/orders');
        }

        const orderSQL = `
            SELECT o.id, o.status, o.total_amount, rr.id AS refund_id
            FROM orders o
            LEFT JOIN refund_requests rr ON rr.order_id = o.id
            WHERE o.id = ? AND o.user_id = ?
        `;

        connection.query(orderSQL, [orderId, userId], (orderErr, rows = []) => {
            if (orderErr || !rows.length) {
                if (orderErr) {
                    console.error('Unable to validate refund request:', orderErr);
                }
                req.flash('error', 'Order not found.');
                return res.redirect('/orders');
            }

            const order = rows[0];
            if (order.refund_id) {
                req.flash('error', 'A refund request has already been submitted.');
                return res.redirect(`/orders/${orderId}/refund`);
            }

            if (order.status !== 'paid') {
                req.flash('error', 'Refund requests are only available for paid orders.');
                return res.redirect(`/orders/${orderId}/refund`);
            }

            const orderTotal = Number(order.total_amount) || 0;
            const reasonCatalog = {
                delivery_late: { label: 'Delivery arrived late', percent: 0.2 },
                missing_items: { label: 'Missing items', percent: 0.5 },
                damaged_item: { label: 'Items damaged', percent: 1 },
                other: { label: 'Other' }
            };

            const presetReason = reasonCatalog[reasonCode] || reasonCatalog.other;
            if (reasonCode === 'other' && !reasonDetails && !imagePath) {
                req.flash('error', 'Please provide details for the "Other" refund reason.');
                return res.redirect(`/orders/${orderId}/refund`);
            }

            let requestedAmount = orderTotal;
            if (typeof presetReason.percent === 'number') {
                requestedAmount = Number((orderTotal * presetReason.percent).toFixed(2));
            } else {
                const parsed = Number(requestedAmountRaw);
                if (!Number.isFinite(parsed) || parsed <= 0) {
                    req.flash('error', 'Enter a valid refund amount.');
                    return res.redirect(`/orders/${orderId}/refund`);
                }
                if (parsed > orderTotal) {
                    req.flash('error', 'Requested amount cannot exceed the order total.');
                    return res.redirect(`/orders/${orderId}/refund`);
                }
                requestedAmount = parsed;
            }

            const insertSQL = `
                INSERT INTO refund_requests (order_id, user_id, reason_text, image_path, requested_amount, status)
                VALUES (?, ?, ?, ?, ?, 'pending')
            `;

            let reasonText = presetReason.label && presetReason.label !== 'Other' ? presetReason.label : '';
            if (reasonDetails) {
                reasonText = reasonText ? `${reasonText} - ${reasonDetails}` : reasonDetails;
            }
            if (!reasonText) {
                reasonText = null;
            }

            connection.query(insertSQL, [orderId, userId, reasonText, imagePath, requestedAmount], (insertErr) => {
                if (insertErr) {
                    if (insertErr.code === 'ER_DUP_ENTRY') {
                        req.flash('error', 'A refund request already exists for this order.');
                    } else {
                        console.error('Unable to create refund request:', insertErr);
                        req.flash('error', 'Unable to submit refund request right now.');
                    }
                    return res.redirect(`/orders/${orderId}/refund`);
                }

                req.flash('success', 'Refund request submitted. Our team will review it soon.');
                res.redirect(`/orders/${orderId}/refund`);
            });
        });
    };

    return {
        renderRefundForm,
        submitRefundRequest
    };
};

module.exports = createRefundController;
