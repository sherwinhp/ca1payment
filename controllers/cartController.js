const createCartController = ({ connection }) => {
    const PAYMENT_METHODS = ['card', 'paypal', 'nets'];
    const checkoutCartSQL = `
            SELECT
                ci.product_id AS productId,
                ci.quantity,
                p.productName,
                p.price,
                p.image,
                p.quantity AS stock,
                p.status
            FROM cart_items ci
            INNER JOIN products p ON p.id = ci.product_id
            WHERE ci.user_id = ?
            ORDER BY ci.created_at ASC, ci.id ASC
        `;

    const getCartForCheckout = (userId) =>
        new Promise((resolve, reject) => {
            connection.query(checkoutCartSQL, [userId], (error, items = []) => {
                if (error) {
                    return reject(error);
                }
                resolve(items);
            });
        });

    const createOrderFromCart = (userId, paymentMethod) =>
        new Promise((resolve, reject) => {
            connection.query(checkoutCartSQL, [userId], (cartErr, items = []) => {
                if (cartErr) {
                    return reject(new Error('Unable to load cart for order.'));
                }

                if (!items.length) {
                    return reject(new Error('Your cart is empty.'));
                }

                let normalizedItems;
                try {
                    normalizedItems = items.map((item) => {
                        const stockCount = Number(item.stock) || 0;
                        const status = item.status === 'sold_out' || stockCount <= 0 ? 'sold_out' : 'in_stock';

                        if (status === 'sold_out' || stockCount <= 0) {
                            throw new Error(`"${item.productName}" is sold out.`);
                        }

                        const safeQuantity = Math.max(1, Math.min(Number(item.quantity) || 1, stockCount));
                        if (safeQuantity !== item.quantity) {
                            throw new Error(`"${item.productName}" has limited stock.`);
                        }

                        return {
                            ...item,
                            safeQuantity,
                            lineTotal: Number(item.price) * safeQuantity
                        };
                    });
                } catch (err) {
                    return reject(err);
                }

                const orderSummary = normalizedItems.reduce(
                    (acc, item) => {
                        acc.total += item.lineTotal;
                        return acc;
                    },
                    { total: 0 }
                );
                const totalAmount = orderSummary.total;

                connection.beginTransaction((txErr) => {
                    if (txErr) {
                        return reject(new Error('Unable to start order transaction.'));
                    }

                    const insertOrderSQL = `
                        INSERT INTO orders (user_id, total_amount, payment_method, status)
                        VALUES (?, ?, ?, 'pending')
                    `;

                    connection.query(
                        insertOrderSQL,
                        [userId, totalAmount.toFixed(2), paymentMethod],
                        (orderErr, orderResult) => {
                            if (orderErr) {
                                return connection.rollback(() =>
                                    reject(new Error('Unable to create order. Please try again.'))
                                );
                            }

                            const orderId = orderResult.insertId;
                            const orderItemValues = normalizedItems
                                .map(() => '(?, ?, ?, ?, ?, ?)')
                                .join(', ');
                            const orderItemParams = normalizedItems.flatMap((item) => [
                                orderId,
                                item.productId,
                                item.productName,
                                item.image,
                                item.safeQuantity,
                                Number(item.price).toFixed(2)
                            ]);

                            const insertItemsSQL = `
                                INSERT INTO order_items (order_id, product_id, product_name_snapshot, product_image_snapshot, quantity, price_at_purchase)
                                VALUES ${orderItemValues}
                            `;

                            connection.query(insertItemsSQL, orderItemParams, (itemsErr) => {
                                if (itemsErr) {
                                    return connection.rollback(() =>
                                        reject(new Error('Unable to add order items. Please try again.'))
                                    );
                                }

                                const updateStockTasks = normalizedItems.map(
                                    (item) =>
                                        new Promise((resolveStock, rejectStock) => {
                                            const updateStockSQL = `
                                                UPDATE products
                                                SET quantity = quantity - ?, status = CASE WHEN quantity - ? <= 0 THEN 'sold_out' ELSE status END
                                                WHERE id = ? AND quantity >= ?
                                            `;
                                            connection.query(
                                                updateStockSQL,
                                                [item.safeQuantity, item.safeQuantity, item.productId, item.safeQuantity],
                                                (stockErr, stockResult) => {
                                                    if (stockErr || !stockResult.affectedRows) {
                                                        return rejectStock(
                                                            new Error(`Unable to reserve stock for "${item.productName}".`)
                                                        );
                                                    }
                                                    resolveStock();
                                                }
                                            );
                                        })
                                );

                                Promise.all(updateStockTasks)
                                    .then(() => {
                                        connection.query(
                                            'DELETE FROM cart_items WHERE user_id = ?',
                                            [userId],
                                            (clearErr) => {
                                                if (clearErr) {
                                                    return connection.rollback(() =>
                                                        reject(new Error('Unable to clear cart after order.'))
                                                    );
                                                }

                                                connection.commit((commitErr) => {
                                                    if (commitErr) {
                                                        return connection.rollback(() =>
                                                            reject(new Error('Unable to finalize order. Please try again.'))
                                                        );
                                                    }

                                                    resolve(orderId);
                                                });
                                            }
                                        );
                                    })
                                    .catch((stockErr) => {
                                        connection.rollback(() => reject(stockErr));
                                    });
                            });
                        }
                    );
                });
            });
        });

    const addToCart = (req, res) => {
        const productId = parseInt(req.params.id, 10);
        const quantity = parseInt(req.body.quantity, 10) || 1;
        const userId = req.session.user.id;

        connection.query('SELECT * FROM products WHERE id = ?', [productId], (error, results) => {
            if (error) throw error;

            if (results.length > 0) {
                const product = results[0];
                const stockCount = Number(product.quantity) || 0;
                const status = stockCount <= 0 ? 'sold_out' : 'in_stock';
                const safeQuantity = Math.max(1, Math.min(quantity, stockCount || 1));

                if (status === 'sold_out' || stockCount <= 0) {
                    req.flash('error', 'This product is sold out and cannot be added to your cart.');
                    return res.redirect(`/product/${productId}`);
                }

                const existingSQL = 'SELECT quantity FROM cart_items WHERE user_id = ? AND product_id = ?';
                connection.query(existingSQL, [userId, productId], (lookupErr, existingRows = []) => {
                    if (lookupErr) {
                        console.error('Unable to look up cart item:', lookupErr);
                        req.flash('error', 'Unable to add to cart right now. Please try again.');
                        return res.redirect(`/product/${productId}`);
                    }

                    const existingQty = existingRows[0] ? Number(existingRows[0].quantity) || 0 : 0;
                    const nextQty = Math.min(stockCount, existingQty + safeQuantity);
                    const upsertSQL = `
                        INSERT INTO cart_items (user_id, product_id, quantity)
                        VALUES (?, ?, ?)
                        ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), updated_at = CURRENT_TIMESTAMP
                    `;

                    connection.query(upsertSQL, [userId, productId, nextQty], (upsertErr) => {
                        if (upsertErr) {
                            console.error('Unable to save cart item:', upsertErr);
                            req.flash('error', 'Unable to add to cart right now. Please try again.');
                        } else {
                            const qtyDiff = nextQty - existingQty;
                            if (qtyDiff < quantity) {
                                req.flash('error', `Only ${stockCount} in stock. Added ${qtyDiff} to your cart.`);
                            } else {
                                req.flash('success', `${product.productName} added to your cart.`);
                            }
                        }
                        res.redirect('/cart');
                    });
                });
            } else {
                res.status(404).send('Product not found');
            }
        });
    };

    const updateCartItem = (req, res) => {
        const productId = parseInt(req.params.id, 10);
        const requestedQty = parseInt(req.body.quantity, 10);
        const userId = req.session.user.id;

        const fetchSQL = `
            SELECT ci.quantity AS cartQuantity, p.quantity AS stock, p.status, p.productName
            FROM cart_items ci
            INNER JOIN products p ON p.id = ci.product_id
            WHERE ci.user_id = ? AND ci.product_id = ?
        `;

        connection.query(fetchSQL, [userId, productId], (error, results) => {
            if (error) {
                console.error('Unable to update cart item:', error);
                req.flash('error', 'Unable to update item right now.');
                return res.redirect('/cart');
            }

            if (!results.length) {
                req.flash('error', 'Item not found in your cart.');
                return res.redirect('/cart');
            }

            const product = results[0];
            const stockCount = Number(product.stock) || 0;
            const status = stockCount <= 0 ? 'sold_out' : 'in_stock';

            if (status === 'sold_out' || stockCount <= 0) {
                req.flash('error', 'This product is sold out and has been removed from your cart.');
                connection.query('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?', [userId, productId], () =>
                    res.redirect('/cart')
                );
                return;
            }

            const safeQty = Math.max(1, Math.min(requestedQty || 1, stockCount));
            const updateSQL = `
                UPDATE cart_items
                SET quantity = ?, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ? AND product_id = ?
            `;
            connection.query(updateSQL, [safeQty, userId, productId], (updateErr) => {
                if (updateErr) {
                    console.error('Unable to persist cart quantity:', updateErr);
                    req.flash('error', 'Unable to update item right now.');
                } else {
                    if (safeQty < requestedQty) {
                        req.flash('error', `Only ${stockCount} in stock. Updated to ${safeQty}.`);
                    } else {
                        req.flash('success', `${product.productName} quantity updated.`);
                    }
                }
                res.redirect('/cart');
            });
        });
    };

    const deleteCartItem = (req, res) => {
        const productId = parseInt(req.params.id, 10);
        const userId = req.session.user.id;

        connection.query('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?', [userId, productId], (error, result) => {
            if (error) {
                console.error('Unable to delete cart item:', error);
                req.flash('error', 'Unable to remove item right now.');
            } else if (result.affectedRows > 0) {
                req.flash('success', 'Item removed from your cart.');
            } else {
                req.flash('error', 'Item not found in your cart.');
            }
            res.redirect('/cart');
        });
    };

    const renderCart = (req, res) => {
        const userId = req.session.user.id;
        const cartSQL = `
            SELECT
                ci.product_id AS productId,
                ci.quantity,
                p.productName,
                p.price,
                p.image,
                p.quantity AS stock,
                CASE WHEN p.quantity <= 0 THEN 'sold_out' ELSE 'in_stock' END AS status,
                ci.created_at
            FROM cart_items ci
            INNER JOIN products p ON p.id = ci.product_id
            WHERE ci.user_id = ?
            ORDER BY ci.created_at ASC, ci.id ASC
        `;

        connection.query(cartSQL, [userId], (error, results = []) => {
            if (error) {
                console.error('Unable to load cart:', error);
                req.flash('error', 'Unable to load your cart right now.');
                return res.render('cart', {
                    cart: [],
                    user: req.session.user,
                    messages: {
                        success: req.flash('success'),
                        error: req.flash('error')
                    }
                });
            }

            res.render('cart', {
                cart: results,
                user: req.session.user,
                messages: {
                    success: req.flash('success'),
                    error: req.flash('error')
                }
            });
        });
    };

    const renderCheckout = (req, res) => {
        const userId = req.session.user.id;
        getCartForCheckout(userId)
            .then((items) => {
                if (!items.length) {
                    req.flash('error', 'Your cart is empty.');
                    return res.redirect('/cart');
                }

                const summary = items.reduce(
                    (acc, item) => {
                        const lineTotal = Number(item.price) * Number(item.quantity || 0);
                        acc.total += lineTotal;
                        return acc;
                    },
                    { total: 0 }
                );

                res.render('checkout', {
                    user: req.session.user,
                    cart: items,
                    total: summary.total.toFixed(2),
                    paymentMethods: PAYMENT_METHODS,
                    selectedMethod: PAYMENT_METHODS[0],
                    paypalClientId: process.env.PAYPAL_CLIENT_ID || '',
                    messages: {
                        error: req.flash('error'),
                        success: req.flash('success')
                    }
                });
            })
            .catch((error) => {
                console.error('Unable to load cart for checkout:', error);
                req.flash('error', 'Unable to load checkout right now.');
                res.redirect('/cart');
            });
    };

    const placeOrder = (req, res) => {
        const userId = req.session.user.id;
        const paymentMethod = PAYMENT_METHODS.includes(req.body.paymentMethod) ? req.body.paymentMethod : PAYMENT_METHODS[0];

        createOrderFromCart(userId, paymentMethod)
            .then((orderId) => {
                res.redirect(`/checkout/success/${orderId}`);
            })
            .catch((error) => {
                console.error('Unable to place order:', error);
                req.flash('error', error.message || 'Unable to place order right now.');
                res.redirect('/cart');
            });
    };

    const renderOrderSuccess = (req, res) => {
        const userId = req.session.user.id;
        const orderId = parseInt(req.params.orderId, 10);
        const orderSQL = `
            SELECT id, total_amount, payment_method, status, created_at
            FROM orders
            WHERE id = ? AND user_id = ?
        `;

        connection.query(orderSQL, [orderId, userId], (error, results = []) => {
            if (error || !results.length) {
                req.flash('error', 'Order not found.');
                return res.redirect('/orders');
            }

            res.render('orderSuccess', {
                user: req.session.user,
                order: results[0]
            });
        });
    };

    const renderOrderHistory = (req, res) => {
        const userId = req.session.user.id;
        const ordersSQL = `
            SELECT id, total_amount, payment_method, status, created_at
            FROM orders
            WHERE user_id = ?
            ORDER BY created_at DESC
        `;

        connection.query(ordersSQL, [userId], (ordersErr, orders = []) => {
            if (ordersErr) {
                console.error('Unable to load orders:', ordersErr);
                req.flash('error', 'Unable to load order history right now.');
                return res.render('orderHistory', {
                    user: req.session.user,
                    orders: [],
                    orderItems: {},
                    messages: {
                        error: req.flash('error'),
                        success: req.flash('success')
                    }
                });
            }

            if (!orders.length) {
                return res.render('orderHistory', {
                    user: req.session.user,
                    orders: [],
                    orderItems: {},
                    messages: {
                        error: req.flash('error'),
                        success: req.flash('success')
                    }
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

                res.render('orderHistory', {
                    user: req.session.user,
                    orders,
                    orderItems: grouped,
                    messages: {
                        error: req.flash('error'),
                        success: req.flash('success')
                    }
                });
            });
        });
    };

    const clearCart = (req, res) => {
        const userId = req.session.user.id;
        connection.query('DELETE FROM cart_items WHERE user_id = ?', [userId], (error) => {
            if (error) {
                console.error('Unable to clear cart:', error);
                req.flash('error', 'Unable to clear cart right now.');
            } else {
                req.flash('success', 'Cart cleared.');
            }
            res.redirect('/cart');
        });
    };

    const renderInvoice = (req, res) => {
        const userId = req.session.user.id;
        const orderId = parseInt(req.params.id, 10);
        const orderSQL = `
            SELECT o.id, o.total_amount, o.payment_method, o.status, o.created_at,
                   u.username, u.email, u.address, u.contact
            FROM orders o
            INNER JOIN users u ON u.id = o.user_id
            WHERE o.id = ? AND o.user_id = ?
        `;

        connection.query(orderSQL, [orderId, userId], (orderErr, orderRows = []) => {
            if (orderErr || !orderRows.length) {
                req.flash('error', 'Order not found.');
                return res.redirect('/orders');
            }

            const order = orderRows[0];
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
                    console.error('Unable to load invoice items:', itemsErr);
                    req.flash('error', 'Unable to load invoice right now.');
                    return res.redirect('/orders');
                }

                res.render('orderInvoice', {
                    user: req.session.user,
                    order,
                    items,
                    isAdminView: false
                });
            });
        });
    };

    return {
        addToCart,
        renderCart,
        updateCartItem,
        deleteCartItem,
        renderCheckout,
        placeOrder,
        renderOrderSuccess,
        renderOrderHistory,
        clearCart,
        renderInvoice,
        getCartForCheckout,
        createOrderFromCart
    };
};

module.exports = createCartController;
