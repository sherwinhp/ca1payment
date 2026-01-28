const paypalService = require('../Services/paypal');
const stripeService = require('../Services/stripe');

const createAdminController = ({ connection, primaryAdminEmail }) => {
    const ORDER_STATUSES = ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'];

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

    const renderUserManagement = (req, res) => {
        const listUsersSQL = `
            SELECT id, username, email, role
            FROM users
            WHERE role <> 'deleted'
            ORDER BY role DESC, username ASC
        `;

        connection.query(listUsersSQL, (error, results = []) => {
            if (error) {
                console.error('Unable to load users for management:', error);
                return res.status(500).send('Unable to load users right now.');
            }

            res.render('manageUsers', {
                user: req.session.user,
                users: results,
                primaryAdminEmail,
                formData: req.flash('userFormData')[0],
                messages: {
                    success: req.flash('success'),
                    error: req.flash('error')
                }
            });
        });
    };

    const renderAllOrders = (req, res) => {
        const search = (req.query.q || '').trim();
        const params = [];
        let ordersSQL = `
            SELECT o.id, o.user_id, o.total_amount, o.payment_method, o.status, o.created_at,
                   u.username, u.email, u.role,
                   rr.approved_amount AS refund_approved_amount
            FROM orders o
            INNER JOIN users u ON u.id = o.user_id
            LEFT JOIN refund_requests rr ON rr.order_id = o.id
        `;

        if (search) {
            ordersSQL += ' WHERE u.username LIKE ? OR u.email LIKE ?';
            params.push(`%${search}%`, `%${search}%`);
        }

        ordersSQL += ' ORDER BY o.created_at DESC';

        const statsSQL = `
            SELECT
                COUNT(*) AS totalOrders,
                SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paidOrders,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingOrders,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedOrders,
                SUM(CASE WHEN status IN ('refunded','partially_refunded') THEN 1 ELSE 0 END) AS refundedOrders,
                SUM(CASE WHEN status = 'paid' THEN total_amount ELSE 0 END) AS totalRevenue
            FROM orders
        `;

        connection.query(statsSQL, (statsErr, statsRows = []) => {
            const stats = statsRows[0] || {
                totalOrders: 0,
                paidOrders: 0,
                pendingOrders: 0,
                failedOrders: 0,
                refundedOrders: 0,
                totalRevenue: 0
            };

            if (statsErr) {
                console.error('Unable to load order stats:', statsErr);
            }

            connection.query(ordersSQL, params, (ordersErr, orders = []) => {
            if (ordersErr) {
                console.error('Unable to load all orders:', ordersErr);
                req.flash('error', 'Unable to load orders right now.');
                return res.render('adminOrders', {
                    user: req.session.user,
                    orders: [],
                    orderItems: {},
                    statuses: ORDER_STATUSES,
                    search,
                    stats,
                    messages: { success: req.flash('success'), error: req.flash('error') }
                });
            }

            if (!orders.length) {
                return res.render('adminOrders', {
                    user: req.session.user,
                    orders: [],
                    orderItems: {},
                    statuses: ORDER_STATUSES,
                    search,
                    stats,
                    messages: { success: req.flash('success'), error: req.flash('error') }
                });
            }

            const orderIds = orders.map((o) => o.id);
            const itemsSQL = `
                SELECT
                    oi.order_id,
                    oi.product_id,
                    oi.quantity,
                    oi.price_at_purchase,
                    oi.product_name_snapshot,
                    oi.product_image_snapshot,
                    p.productName,
                    p.image
                FROM order_items oi
                LEFT JOIN products p ON p.id = oi.product_id
                WHERE oi.order_id IN (?)
                ORDER BY oi.id ASC
            `;

            connection.query(itemsSQL, [orderIds], (itemsErr, items = []) => {
                if (itemsErr) {
                    console.error('Unable to load order items:', itemsErr);
                    req.flash('error', 'Unable to load order items right now.');
                }

                const grouped = items.reduce((acc, item) => {
                    if (!acc[item.order_id]) acc[item.order_id] = [];
                    acc[item.order_id].push(item);
                    return acc;
                }, {});

                res.render('adminOrders', {
                    user: req.session.user,
                    orders,
                    orderItems: grouped,
                    statuses: ORDER_STATUSES,
                    search,
                    stats,
                    messages: { success: req.flash('success'), error: req.flash('error') }
                });
            });
        });
        });
    };

    const updateOrderStatus = (req, res) => {
        req.flash('error', 'Order status is auto-updated by the payment flow.');
        return res.redirect('/admin/orders');
    };

    const promoteUser = (req, res) => {
        const targetUserId = parseInt(req.params.id, 10);

        if (!Number.isInteger(targetUserId)) {
            req.flash('error', 'Invalid user selected.');
            return res.redirect('/admin/users');
        }

        const promoteSQL = `
            UPDATE users
            SET role = 'admin'
            WHERE id = ? AND email <> ? AND role <> 'admin'
        `;

        connection.query(promoteSQL, [targetUserId, primaryAdminEmail], (error, result) => {
            if (error) {
                console.error('Unable to promote user:', error);
                req.flash('error', 'Unable to promote user right now.');
            } else if (!result.affectedRows) {
                req.flash('error', 'User not found or already an admin.');
            } else {
                req.flash('success', 'User has been promoted to admin.');
            }

            res.redirect('/admin/users');
        });
    };

    const demoteUser = (req, res) => {
        const targetUserId = parseInt(req.params.id, 10);

        if (!Number.isInteger(targetUserId)) {
            req.flash('error', 'Invalid user selected.');
            return res.redirect('/admin/users');
        }

        if (targetUserId === req.session.user.id) {
            req.flash('error', 'You cannot change your own role here.');
            return res.redirect('/admin/users');
        }

        const demoteSQL = `
            UPDATE users
            SET role = 'user'
            WHERE id = ? AND email <> ? AND role = 'admin'
        `;

        connection.query(demoteSQL, [targetUserId, primaryAdminEmail], (error, result) => {
            if (error) {
                console.error('Unable to demote user:', error);
                req.flash('error', 'Unable to demote user right now.');
            } else if (!result.affectedRows) {
                req.flash('error', 'User not found or cannot be demoted.');
            } else {
                req.flash('success', 'Admin has been demoted to user.');
            }

            res.redirect('/admin/users');
        });
    };

    const createUser = (req, res) => {
        const { username, email, password, address, contact, role } = req.body;
        const normalizedRole = role === 'admin' ? 'admin' : 'user';
        const errors = [];

        if (!username || !email || !password || !address || !contact) {
            errors.push('All fields are required to create a user.');
        }

        if (password && password.length < 6) {
            errors.push('Password must be at least 6 characters long.');
        }

        if (errors.length) {
            errors.forEach((message) => req.flash('error', message));
            req.flash('userFormData', { username, email, address, contact, role: normalizedRole });
            return res.redirect('/admin/users');
        }

        const emailCheckSQL = 'SELECT id FROM users WHERE email = ?';
        connection.query(emailCheckSQL, [email], (checkErr, existing = []) => {
            if (checkErr) {
                console.error('Unable to check email before creating user:', checkErr);
                req.flash('error', 'Unable to create user right now.');
                req.flash('userFormData', { username, email, address, contact, role: normalizedRole });
                return res.redirect('/admin/users');
            }

            if (existing.length) {
                req.flash('error', 'This email is already registered.');
                req.flash('userFormData', { username, email, address, contact, role: normalizedRole });
                return res.redirect('/admin/users');
            }

            const insertSQL = `
                INSERT INTO users (username, email, password, address, contact, role)
                VALUES (?, ?, SHA1(?), ?, ?, ?)
            `;

            connection.query(insertSQL, [username, email, password, address, contact, normalizedRole], (insertErr) => {
                if (insertErr) {
                    console.error('Unable to create user:', insertErr);
                    req.flash('error', 'Unable to create user right now.');
                    req.flash('userFormData', { username, email, address, contact, role: normalizedRole });
                } else {
                    req.flash('success', `Created ${normalizedRole} account for ${username}.`);
                }

                res.redirect('/admin/users');
            });
        });
    };

    const deleteUser = (req, res) => {
        const targetUserId = parseInt(req.params.id, 10);

        if (!Number.isInteger(targetUserId)) {
            req.flash('error', 'Invalid user selected.');
            return res.redirect('/admin/users');
        }

        if (targetUserId === req.session.user.id) {
            req.flash('error', 'You cannot delete your own account from the dashboard.');
            return res.redirect('/admin/users');
        }

        const tombstoneEmail = `deleted_${targetUserId}_${Date.now()}@deleted.local`;
        const tombstonePassword = `deleted_${targetUserId}_${Date.now()}`;
        const tombstoneAddress = 'Removed';
        const tombstoneContact = '00000000';
        const anonymizeSQL = `
            UPDATE users
            SET
                username = 'Deleted user',
                email = ?,
                password = SHA1(?),
                address = ?,
                contact = ?,
                role = 'deleted'
            WHERE id = ? AND email <> ?
        `;

        connection.query(
            anonymizeSQL,
            [tombstoneEmail, tombstonePassword, tombstoneAddress, tombstoneContact, targetUserId, primaryAdminEmail],
            (error, result) => {
            if (error) {
                console.error('Unable to delete user:', error);
                req.flash('error', 'Unable to delete user right now.');
            } else if (!result.affectedRows) {
                req.flash('error', 'User not found or cannot be deleted.');
            } else {
                req.flash('success', 'User account deleted (order history retained).');
            }

            res.redirect('/admin/users');
        }
        );
    };

    const renderInvoice = (req, res) => {
        const orderId = parseInt(req.params.id, 10);
        const orderSQL = `
            SELECT o.id, o.total_amount, o.payment_method, o.status, o.created_at, o.payment_reference,
                   u.username, u.email, u.address, u.contact
            FROM orders o
            INNER JOIN users u ON u.id = o.user_id
            WHERE o.id = ?
        `;

        connection.query(orderSQL, [orderId], (orderErr, orders = []) => {
            if (orderErr || !orders.length) {
                req.flash('error', 'Order not found.');
                return res.redirect('/admin/orders');
            }

            const order = orders[0];
            const itemsSQL = `
                SELECT
                    oi.product_id,
                    oi.quantity,
                    oi.price_at_purchase,
                    oi.product_name_snapshot,
                    oi.product_image_snapshot,
                    p.productName,
                    p.image
                FROM order_items oi
                LEFT JOIN products p ON p.id = oi.product_id
                WHERE oi.order_id = ?
                ORDER BY oi.id ASC
            `;

            connection.query(itemsSQL, [orderId], (itemsErr, items = []) => {
                if (itemsErr) {
                    console.error('Unable to load invoice items for admin:', itemsErr);
                    req.flash('error', 'Unable to load invoice right now.');
                    return res.redirect('/admin/orders');
                }

                res.render('orderInvoice', {
                    user: req.session.user,
                    order,
                    items,
                    isAdminView: true
                });
            });
        });
    };

    const renderRefundRequests = (req, res) => {
        const rawPercent = String(req.params.percent || req.query.percent || '').trim();
        const percent = rawPercent ? Number(rawPercent) : null;
        const allowedPercents = [1, 0.7, 0.5, 0.25];
        const hasFilter = Number.isFinite(percent) && allowedPercents.includes(percent);
        const isOtherFilter = rawPercent === 'other';
        const refundsParams = [];
        let filterClause = '';

        if (hasFilter) {
            filterClause = `
            WHERE rr.requested_amount IS NOT NULL
              AND o.total_amount IS NOT NULL
              AND ABS(rr.requested_amount - (o.total_amount * ?)) <= 0.01
            `;
            refundsParams.push(percent);
        } else if (isOtherFilter) {
            filterClause = `
            WHERE rr.requested_amount IS NOT NULL
              AND o.total_amount IS NOT NULL
              AND ABS(rr.requested_amount - (o.total_amount * 1)) > 0.01
              AND ABS(rr.requested_amount - (o.total_amount * 0.7)) > 0.01
              AND ABS(rr.requested_amount - (o.total_amount * 0.5)) > 0.01
              AND ABS(rr.requested_amount - (o.total_amount * 0.25)) > 0.01
            `;
        }

        const refundsSQL = `
              SELECT
                  rr.id,
                  rr.order_id,
                  rr.user_id,
                  rr.reason_text,
                  rr.image_path,
                  rr.requested_amount,
                  rr.approved_amount,
                  rr.status,
                  rr.admin_note,
                  rr.approved_by,
                  rr.denied_by,
                  rr.approved_at,
                  rr.denied_at,
                  rr.created_at,
                o.total_amount,
                o.payment_method,
                u.username,
                u.email,
                au.username AS approved_by_name,
                au.email AS approved_by_email,
                du.username AS denied_by_name,
                du.email AS denied_by_email
            FROM refund_requests rr
            INNER JOIN orders o ON o.id = rr.order_id
            INNER JOIN users u ON u.id = rr.user_id
            LEFT JOIN users au ON au.id = rr.approved_by
            LEFT JOIN users du ON du.id = rr.denied_by
            ${filterClause}
            ORDER BY rr.created_at DESC
        `;

        connection.query(refundsSQL, refundsParams, (refundErr, refunds = []) => {
            if (refundErr) {
                console.error('Unable to load refund requests:', refundErr);
                req.flash('error', 'Unable to load refund requests right now.');
                return res.render('adminRefunds', {
                    user: req.session.user,
                    refunds: [],
                    filterPercent: hasFilter ? percent : null,
                    filterOther: isOtherFilter,
                    messages: { success: req.flash('success'), error: req.flash('error') }
                });
            }

            res.render('adminRefunds', {
                user: req.session.user,
                refunds,
                filterPercent: hasFilter ? percent : null,
                filterOther: isOtherFilter,
                messages: { success: req.flash('success'), error: req.flash('error') }
            });
        });
    };

    const approveRefund = (req, res) => {
        const refundId = parseInt(req.params.id, 10);
        const adminNote = (req.body.adminNote || '').trim();
        const approvedAmountRaw = (req.body.approvedAmount || '').trim();

        if (!Number.isInteger(refundId)) {
            req.flash('error', 'Invalid refund request selected.');
            return res.redirect('/admin/refunds');
        }

        connection.query(
            'SELECT id, order_id, status, requested_amount FROM refund_requests WHERE id = ?',
            [refundId],
            (lookupErr, rows = []) => {
                if (lookupErr || !rows.length) {
                    if (lookupErr) {
                        console.error('Unable to find refund request:', lookupErr);
                    }
                    req.flash('error', 'Refund request not found.');
                    return res.redirect('/admin/refunds');
                }

                const refund = rows[0];
                if (refund.status !== 'pending') {
                    req.flash('error', 'Refund request is already processed.');
                    return res.redirect('/admin/refunds');
                }

                const orderLookupSQL = `
                    SELECT id, total_amount, payment_method, payment_reference
                    FROM orders
                    WHERE id = ?
                `;

                connection.query(orderLookupSQL, [refund.order_id], async (orderErr, orderRows = []) => {
                    if (orderErr || !orderRows.length) {
                        if (orderErr) {
                            console.error('Unable to load order for refund:', orderErr);
                        }
                        req.flash('error', 'Order not found for refund.');
                        return res.redirect('/admin/refunds');
                    }

                    const order = orderRows[0];
                    const orderTotal = Number(order.total_amount) || 0;
                    const requestedAmount = Number(refund.requested_amount) || orderTotal;
                    let approvedAmount = requestedAmount;

                    if (approvedAmountRaw) {
                        const parsed = Number(approvedAmountRaw);
                        if (!Number.isFinite(parsed) || parsed <= 0) {
                            req.flash('error', 'Approved amount must be a valid number.');
                            return res.redirect('/admin/refunds');
                        }
                        if (parsed > requestedAmount) {
                            req.flash('error', 'Approved amount cannot exceed requested amount.');
                            return res.redirect('/admin/refunds');
                        }
                        approvedAmount = parsed;
                    }
                    if (order.payment_method === 'paypal') {
                        if (!order.payment_reference) {
                            req.flash('error', 'Missing PayPal capture ID for this order.');
                            return res.redirect('/admin/refunds');
                        }
                        try {
                            await paypalService.refundCapture(order.payment_reference, approvedAmount);
                        } catch (apiErr) {
                            console.error('PayPal refund failed:', apiErr);
                            req.flash('error', apiErr.message || 'PayPal refund failed.');
                            return res.redirect('/admin/refunds');
                        }
                    } else if (order.payment_method === 'card') {
                        const ref = String(order.payment_reference || '');
                        const chargeId = ref.includes(':') ? ref.split(':')[1] : ref;
                        if (!chargeId) {
                            req.flash('error', 'Missing Stripe charge ID for this order.');
                            return res.redirect('/admin/refunds');
                        }
                        try {
                            await stripeService.refundCharge({ chargeId, amount: approvedAmount });
                        } catch (apiErr) {
                            console.error('Stripe refund failed:', apiErr);
                            req.flash('error', apiErr.message || 'Stripe refund failed.');
                            return res.redirect('/admin/refunds');
                        }
                    }

                    const updateRefundSQL = `
                        UPDATE refund_requests
                        SET status = 'approved',
                            admin_note = ?,
                            approved_amount = ?,
                            approved_by = ?,
                            approved_at = CURRENT_TIMESTAMP,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                    `;

                    connection.query(
                        updateRefundSQL,
                        [adminNote || null, approvedAmount, req.session.user.id, refundId],
                        (updateErr) => {
                        if (updateErr) {
                            console.error('Unable to approve refund request:', updateErr);
                            req.flash('error', 'Unable to approve refund request right now.');
                            return res.redirect('/admin/refunds');
                        }

                        const nextStatus = approvedAmount < orderTotal ? 'partially_refunded' : 'refunded';
                        connection.query(
                            'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                            [nextStatus, refund.order_id],
                            (finalizeErr) => {
                                if (finalizeErr) {
                                    console.error('Unable to update order status for refund:', finalizeErr);
                                    req.flash('error', 'Refund approved but order status failed to update.');
                                } else {
                                    logPaymentEvent({
                                        orderId: refund.order_id,
                                        provider: order.payment_method || 'refund',
                                        eventType: 'refund.approved',
                                        status: nextStatus,
                                        message: adminNote || `Refund approved: $${approvedAmount.toFixed(2)}`
                                    });
                                    req.flash(
                                        'success',
                                        `Refund approved for order #${refund.order_id} (${nextStatus.replace('_', ' ')}).`
                                    );
                                }
                                res.redirect('/admin/refunds');
                            }
                        );
                    });
                });
            }
        );
    };

    const denyRefund = (req, res) => {
        const refundId = parseInt(req.params.id, 10);
        const adminNote = (req.body.adminNote || '').trim();

        if (!Number.isInteger(refundId)) {
            req.flash('error', 'Invalid refund request selected.');
            return res.redirect('/admin/refunds');
        }

        const updateRefundSQL = `
            UPDATE refund_requests
            SET status = 'denied',
                admin_note = ?,
                denied_by = ?,
                denied_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'pending'
        `;

        connection.query(updateRefundSQL, [adminNote || null, req.session.user.id, refundId], (updateErr, result) => {
            if (updateErr) {
                console.error('Unable to deny refund request:', updateErr);
                req.flash('error', 'Unable to deny refund request right now.');
            } else if (!result.affectedRows) {
                req.flash('error', 'Refund request is already processed or not found.');
            } else {
                req.flash('success', 'Refund request denied.');
            }
            res.redirect('/admin/refunds');
        });
    };


    const renderPaymentEvents = (req, res) => {
        const search = String(req.query.q || '').trim();
        const provider = String(req.query.provider || '').trim();
        const status = String(req.query.status || '').trim();
        const eventType = String(req.query.type || '').trim();

        const where = [];
        const params = [];

        if (search) {
            where.push(
                `(CAST(pe.order_id AS CHAR) LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR pe.event_type LIKE ? OR pe.message LIKE ?)`
            );
            const like = `%${search}%`;
            params.push(like, like, like, like, like);
        }
        if (provider) {
            where.push('pe.provider = ?');
            params.push(provider);
        }
        if (status) {
            where.push('pe.status = ?');
            params.push(status);
        }
        if (eventType) {
            where.push('pe.event_type = ?');
            params.push(eventType);
        }

        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const eventsSQL = `
            SELECT
                pe.id,
                pe.order_id,
                pe.provider,
                pe.event_type,
                pe.status,
                pe.message,
                pe.created_at,
                o.total_amount,
                o.payment_method,
                u.username,
                u.email
            FROM payment_events pe
            LEFT JOIN orders o ON o.id = pe.order_id
            LEFT JOIN users u ON u.id = o.user_id
            ${whereClause}
            ORDER BY pe.created_at DESC
            LIMIT 200
        `;

        const distinctProvidersSQL = 'SELECT DISTINCT provider FROM payment_events ORDER BY provider ASC';
        const distinctStatusesSQL = 'SELECT DISTINCT status FROM payment_events ORDER BY status ASC';
        const distinctTypesSQL = 'SELECT DISTINCT event_type FROM payment_events ORDER BY event_type ASC';

        const loadDistinct = (sql) =>
            new Promise((resolve) => {
                connection.query(sql, (err, rows = []) => {
                    if (err) return resolve([]);
                    resolve(rows.map((row) => Object.values(row)[0]).filter(Boolean));
                });
            });

        Promise.all([
            new Promise((resolve) => {
                connection.query(eventsSQL, params, (error, events = []) => {
                    if (error) return resolve({ error, events: [] });
                    resolve({ error: null, events });
                });
            }),
            loadDistinct(distinctProvidersSQL),
            loadDistinct(distinctStatusesSQL),
            loadDistinct(distinctTypesSQL)
        ])
            .then(([eventsResult, providers, statuses, types]) => {
                if (eventsResult.error) {
                    console.error('Unable to load payment events:', eventsResult.error);
                    req.flash('error', 'Unable to load payment logs right now.');
                }

                res.render('adminPaymentEvents', {
                    user: req.session.user,
                    events: eventsResult.events,
                    providers,
                    statuses,
                    types,
                    filters: {
                        search,
                        provider,
                        status,
                        type: eventType
                    },
                    messages: { success: req.flash('success'), error: req.flash('error') }
                });
            })
            .catch((error) => {
                console.error('Unable to load payment events:', error);
                req.flash('error', 'Unable to load payment logs right now.');
                res.render('adminPaymentEvents', {
                    user: req.session.user,
                    events: [],
                    providers: [],
                    statuses: [],
                    types: [],
                    filters: { search, provider, status, type: eventType },
                    messages: { success: req.flash('success'), error: req.flash('error') }
                });
            });
    };

    return {
        renderUserManagement,
        renderAllOrders,
        updateOrderStatus,
        promoteUser,
        demoteUser,
        createUser,
        deleteUser,
        renderInvoice,
        renderRefundRequests,
        approveRefund,
        denyRefund,
        renderPaymentEvents
    };
};

module.exports = createAdminController;
