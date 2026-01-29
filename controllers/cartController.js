const nodemailer = require('nodemailer');
const stripeService = require('../Services/stripe');

const createCartController = ({ connection }) => {
    const PAYMENT_METHODS = ['card', 'paypal', 'nets'];
    let invoiceMailer = null;

    const getInvoiceMailer = () => {
        if (process.env.EMAIL_DISABLED === 'true') return null;
        if (invoiceMailer) return invoiceMailer;

        const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS } = process.env;
        if (!EMAIL_HOST || !EMAIL_PORT || !EMAIL_USER || !EMAIL_PASS) return null;

        const port = Number(EMAIL_PORT);
        invoiceMailer = nodemailer.createTransport({
            host: EMAIL_HOST,
            port,
            secure: port === 465,
            requireTLS: port !== 465,
            auth: {
                user: EMAIL_USER,
                pass: EMAIL_PASS
            },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 10000
        });

        return invoiceMailer;
    };

    const buildInvoiceEmail = ({ order, items }) => {
        const logoUrl = (process.env.EMAIL_LOGO_URL || '').trim();
        const logoHtml = logoUrl
            ? `<img src="${logoUrl}" alt="Sherwin Supermarket" style="height: 36px; display: block;" />`
            : `<div style="font-size: 16px; font-weight: 700; color: #0f172a;">Sherwin Supermarket</div>`;
        const subject = `Invoice for order #${order.id}`;
        const lines = [
            `Hi ${order.username || 'there'},`,
            '',
            `Here is your invoice for order #${order.id}.`,
            '',
            ...items.map((item) => {
                const name = item.productName || item.product_name_snapshot || 'Product';
                const qty = Number(item.quantity) || 0;
                const price = Number(item.price_at_purchase || 0).toFixed(2);
                return `- ${name} x${qty} @ $${price}`;
            }),
            '',
            `Total: $${Number(order.total_amount || 0).toFixed(2)}`,
            '',
            'Thank you for shopping at Sherwin Supermarket.',
            'Supermarket Support'
        ];
        const rowsHtml = items
            .map((item) => {
                const name = item.productName || item.product_name_snapshot || 'Product';
                const qty = Number(item.quantity) || 0;
                const price = Number(item.price_at_purchase || 0);
                const lineTotal = qty * price;
                return `
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0;">${name}</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; text-align: center;">${qty}</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; text-align: right;">$${price.toFixed(2)}</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #e2e8f0; text-align: right;">$${lineTotal.toFixed(2)}</td>
                  </tr>
                `;
            })
            .join('');

        const html = `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; background: #f8fafc; padding: 24px;">
              <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden;">
                <div style="padding: 16px 24px; border-bottom: 1px solid #e2e8f0; background: #ffffff;">
                  ${logoHtml}
                </div>
                <div style="padding: 24px;">
                  <h2 style="margin: 0 0 6px; font-size: 20px; color: #0f172a;">Invoice for order #${order.id}</h2>
                  <p style="margin: 0 0 16px; color: #475569;">Placed ${new Date(order.created_at).toLocaleString()}</p>
                  <table role="presentation" style="width: 100%; border-collapse: collapse; font-size: 14px; color: #0f172a;">
                    <thead>
                      <tr style="text-transform: uppercase; font-size: 12px; letter-spacing: 0.08em; color: #64748b;">
                        <th style="text-align: left; padding-bottom: 8px;">Item</th>
                        <th style="text-align: center; padding-bottom: 8px;">Qty</th>
                        <th style="text-align: right; padding-bottom: 8px;">Unit</th>
                        <th style="text-align: right; padding-bottom: 8px;">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${rowsHtml}
                      <tr>
                        <td colspan="3" style="padding-top: 12px; text-align: right; font-weight: 700;">Grand total</td>
                        <td style="padding-top: 12px; text-align: right; font-weight: 700; color: #2563eb;">$${Number(
                            order.total_amount || 0
                        ).toFixed(2)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p style="margin: 16px 0 0; color: #475569;">Thank you for shopping at Sherwin Supermarket.</p>
                </div>
                <div style="padding: 16px 24px; background: #f8fafc; font-size: 12px; color: #94a3b8;">
                  Sherwin Supermarket Support
                </div>
              </div>
            </div>
        `;

        return { subject, text: lines.join('\n'), html };
    };
    const normalizeCardNumber = (value) => String(value || '').replace(/\D/g, '');
    const isValidCardNumber = (value) => {
        const digits = normalizeCardNumber(value);
        if (digits.length < 13 || digits.length > 19) {
            return false;
        }
        let sum = 0;
        let shouldDouble = false;
        for (let i = digits.length - 1; i >= 0; i -= 1) {
            let digit = Number(digits[i]);
            if (Number.isNaN(digit)) return false;
            if (shouldDouble) {
                digit *= 2;
                if (digit > 9) digit -= 9;
            }
            sum += digit;
            shouldDouble = !shouldDouble;
        }
        return sum % 10 === 0;
    };
    const isValidExpiry = (value) => {
        const match = String(value || '').trim().match(/^(\d{2})\s*\/\s*(\d{2}|\d{4})$/);
        if (!match) return false;
        const month = Number(match[1]);
        if (month < 1 || month > 12) return false;
        let year = Number(match[2]);
        if (year < 100) year += 2000;
        const lastDay = new Date(year, month, 0);
        const now = new Date();
        return lastDay >= new Date(now.getFullYear(), now.getMonth(), 1);
    };
    const isValidCvv = (value) => /^\d{3,4}$/.test(String(value || '').trim());
    const getCardBrand = (value) => {
        const digits = normalizeCardNumber(value);
        if (!digits) return null;
        if (digits.startsWith('4')) {
            return 'visa';
        }
        const firstTwo = Number(digits.slice(0, 2));
        const firstFour = Number(digits.slice(0, 4));
        if ((firstTwo >= 51 && firstTwo <= 55) || (firstFour >= 2221 && firstFour <= 2720)) {
            return 'mastercard';
        }
        return null;
    };

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

    const createOrderFromCart = (userId, paymentMethod, status = 'pending', paymentReference = null) =>
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
                        INSERT INTO orders (user_id, total_amount, payment_method, status, payment_reference)
                        VALUES (?, ?, ?, ?, ?)
                    `;

                    connection.query(
                        insertOrderSQL,
                        [userId, totalAmount.toFixed(2), paymentMethod, status, paymentReference],
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
                    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
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

        if (paymentMethod === 'card') {
            const cardErrors = [];
            const cardName = String(req.body.cardName || '').trim();
            const paymentMethodId = String(req.body.paymentMethodId || '').trim();
            if (cardName.length < 2) {
                cardErrors.push('Cardholder name looks invalid.');
            }
            if (!paymentMethodId) {
                cardErrors.push('Payment method could not be created.');
            }

            if (cardErrors.length) {
                const message = encodeURIComponent(cardErrors[0]);
                return res.redirect(`/checkout/failure?method=card&reason=error&message=${message}`);
            }
        }

        if (paymentMethod === 'card') {
            const paymentMethodId = String(req.body.paymentMethodId || '').trim();

            let riskLevel = 'unknown';
            return getCartForCheckout(userId)
                .then((items) => {
                    if (!items.length) {
                        throw new Error('Your cart is empty.');
                    }
                    if (!paymentMethodId) {
                        throw new Error('Payment method is missing.');
                    }
                    const total = items.reduce(
                        (acc, item) => acc + Number(item.price) * Number(item.quantity || 0),
                        0
                    );
                    return stripeService.createPaymentIntent({
                        amount: total,
                        currency: 'sgd',
                        paymentMethodId,
                        description: `SupermarketAppMVC order for user ${userId}`,
                        metadata: { userId: String(userId) }
                    });
                })
                .then((intent) => {
                    if (intent.status !== 'succeeded') {
                        throw new Error(`Stripe payment status: ${intent.status}`);
                    }
                    const charge = intent.charges?.data?.[0];
                    const cardBrand = charge?.payment_method_details?.card?.brand || 'card';
                    const paymentReference = `${cardBrand}:${intent.id}`;
                    const outcome = charge?.outcome || null;
                    riskLevel = outcome?.risk_level || 'unknown';
                    const nextStatus = 'paid';

                    return createOrderFromCart(userId, paymentMethod, nextStatus, paymentReference)
                        .then((orderId) => {
                            if (outcome) {
                                logPaymentEvent({
                                    orderId,
                                    provider: 'card',
                                    eventType: 'card.risk',
                                    status: riskLevel,
                                    message: outcome.seller_message || 'Card risk assessment',
                                    payload: outcome
                                });
                            }
                            return orderId;
                        });
                })
                .then((orderId) => {
                    if (orderId) {
                        logPaymentEvent({
                            orderId,
                            provider: 'card',
                            eventType: 'card.paid',
                            status: 'paid',
                            message: 'Stripe card payment completed.'
                        });
                    }
                    res.redirect(`/checkout/loading?orderId=${orderId}&method=card`);
                })
                .catch((error) => {
                    console.error('Unable to place card order:', error);
                    const message = encodeURIComponent(error.message || 'Card payment failed.');
                    res.redirect(`/checkout/failure?method=card&reason=error&message=${message}`);
                });
        }

        const initialStatus = 'pending';
        createOrderFromCart(userId, paymentMethod, initialStatus, null)
            .then((orderId) => {
                res.redirect(`/checkout/loading?orderId=${orderId}&method=${paymentMethod}`);
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
            SELECT id, total_amount, payment_method, status, created_at, payment_reference
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
            SELECT
                o.id,
                o.total_amount,
                o.payment_method,
                o.payment_reference,
                o.status,
                o.created_at,
                rr.id AS refund_id,
                rr.status AS refund_status,
                rr.admin_note AS refund_admin_note,
                rr.requested_amount,
                rr.approved_amount
            FROM orders o
            LEFT JOIN refund_requests rr ON rr.order_id = o.id
            WHERE o.user_id = ?
            ORDER BY o.created_at DESC
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
            SELECT o.id, o.total_amount, o.payment_method, o.status, o.created_at, o.payment_reference,
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
                    isAdminView: false,
                    messages: {
                        error: req.flash('error'),
                        success: req.flash('success')
                    }
                });
            });
        });
    };

    const sendInvoiceEmail = (req, res) => {
        const userId = req.session.user.id;
        const orderId = parseInt(req.params.id, 10);

        if (!Number.isInteger(orderId)) {
            req.flash('error', 'Invalid order selected.');
            return res.redirect('/orders');
        }

        const orderSQL = `
            SELECT o.id, o.total_amount, o.payment_method, o.status, o.created_at, o.payment_reference,
                   u.username, u.email, u.address, u.contact
            FROM orders o
            INNER JOIN users u ON u.id = o.user_id
            WHERE o.id = ? AND o.user_id = ?
        `;

        connection.query(orderSQL, [orderId, userId], (orderErr, orderRows = []) => {
            if (orderErr || !orderRows.length) {
                if (orderErr) {
                    console.error('Unable to load invoice order:', orderErr);
                }
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

            connection.query(itemsSQL, [orderId], async (itemsErr, items = []) => {
                if (itemsErr) {
                    console.error('Unable to load invoice items for email:', itemsErr);
                    req.flash('error', 'Unable to email invoice right now.');
                    return res.redirect(`/orders/${orderId}/invoice`);
                }

                const mailer = getInvoiceMailer();
                if (!mailer) {
                    req.flash('error', 'Email is not configured. Please check email settings and try again.');
                    return res.redirect(`/orders/${orderId}/invoice`);
                }

                const { subject, text, html } = buildInvoiceEmail({ order, items });
                const message = {
                    from: process.env.EMAIL_FROM || process.env.EMAIL_USER || 'no-reply@supermarket.local',
                    to: order.email,
                    subject,
                    text,
                    html
                };

                try {
                    await mailer.sendMail(message);
                    req.flash('success', 'Invoice email sent to your registered email.');
                } catch (emailErr) {
                    console.error('Unable to send invoice email:', emailErr);
                    req.flash('error', 'Unable to send invoice email right now. Please try again later.');
                }

                res.redirect(`/orders/${orderId}/invoice`);
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
        sendInvoiceEmail,
        getCartForCheckout,
        createOrderFromCart
    };
};

module.exports = createCartController;
