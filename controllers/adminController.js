const createAdminController = ({ connection, primaryAdminEmail }) => {
    const ORDER_STATUSES = ['pending', 'delivering', 'delivered'];

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
                   u.username, u.email, u.role
            FROM orders o
            INNER JOIN users u ON u.id = o.user_id
        `;

        if (search) {
            ordersSQL += ' WHERE u.username LIKE ? OR u.email LIKE ?';
            params.push(`%${search}%`, `%${search}%`);
        }

        ordersSQL += ' ORDER BY o.created_at DESC';

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
                    messages: { success: req.flash('success'), error: req.flash('error') }
                });
            });
        });
    };

    const updateOrderStatus = (req, res) => {
        const orderId = parseInt(req.params.id, 10);
        const status = req.body.status;

        if (!ORDER_STATUSES.includes(status)) {
            req.flash('error', 'Invalid status selected.');
            return res.redirect('/admin/orders');
        }

        connection.query(
            'UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [status, orderId],
            (error, result) => {
                if (error) {
                    console.error('Unable to update order status:', error);
                    req.flash('error', 'Unable to update order status right now.');
                } else if (!result.affectedRows) {
                    req.flash('error', 'Order not found.');
                } else {
                    req.flash('success', `Order #${orderId} marked as ${status}.`);
                }

                res.redirect('/admin/orders');
            }
        );
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
            SELECT o.id, o.total_amount, o.payment_method, o.status, o.created_at,
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

    return {
        renderUserManagement,
        renderAllOrders,
        updateOrderStatus,
        promoteUser,
        demoteUser,
        createUser,
        deleteUser,
        renderInvoice
    };
};

module.exports = createAdminController;
