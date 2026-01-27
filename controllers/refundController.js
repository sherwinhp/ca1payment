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
                rr.admin_note AS refund_admin_note
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
        const reason = (req.body.reason || '').trim();
        const imagePath = req.file ? `/uploads/refunds/${req.file.filename}` : null;

        if (!Number.isInteger(orderId)) {
            req.flash('error', 'Invalid order selected.');
            return res.redirect('/orders');
        }

        const orderSQL = `
            SELECT o.id, o.status, rr.id AS refund_id
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

            if (!reason && !imagePath) {
                req.flash('error', 'Please provide a reason or an image for the refund request.');
                return res.redirect(`/orders/${orderId}/refund`);
            }

            const insertSQL = `
                INSERT INTO refund_requests (order_id, user_id, reason_text, image_path, status)
                VALUES (?, ?, ?, ?, 'pending')
            `;

            connection.query(insertSQL, [orderId, userId, reason || null, imagePath], (insertErr) => {
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
