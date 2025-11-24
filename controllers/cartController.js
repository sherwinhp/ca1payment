const createCartController = ({ connection }) => {
    const addToCart = (req, res) => {
        const productId = parseInt(req.params.id, 10);
        const quantity = parseInt(req.body.quantity, 10) || 1;

        connection.query('SELECT * FROM products WHERE id = ?', [productId], (error, results) => {
            if (error) throw error;

            if (results.length > 0) {
                const product = results[0];
                const stockCount = Number(product.quantity) || 0;
                const status = product.status || (stockCount > 0 ? 'in_stock' : 'sold_out');
                const safeQuantity = Math.max(1, Math.min(quantity, stockCount || 1));

                if (status === 'sold_out' || stockCount <= 0) {
                    req.flash('error', 'This product is sold out and cannot be added to your cart.');
                    return res.redirect(`/product/${productId}`);
                }

                if (!req.session.cart) {
                    req.session.cart = [];
                }

                const existingItem = req.session.cart.find((item) => item.productId === productId);
                if (existingItem) {
                    existingItem.quantity = Math.min(stockCount, existingItem.quantity + safeQuantity);
                } else {
                    req.session.cart.push({
                        productId,
                        productName: product.productName,
                        price: product.price,
                        quantity: safeQuantity,
                        image: product.image,
                        status
                    });
                }

                req.flash('success', `${product.productName} added to your cart.`);
                res.redirect('/cart');
            } else {
                res.status(404).send('Product not found');
            }
        });
    };

    const updateCartItem = (req, res) => {
        const productId = parseInt(req.params.id, 10);
        const requestedQty = parseInt(req.body.quantity, 10);

        if (!req.session.cart) {
            req.flash('error', 'Your cart is empty.');
            return res.redirect('/cart');
        }

        const cartItem = req.session.cart.find((item) => item.productId === productId);
        if (!cartItem) {
            req.flash('error', 'Item not found in your cart.');
            return res.redirect('/cart');
        }

        connection.query('SELECT quantity, status FROM products WHERE id = ?', [productId], (error, results) => {
            if (error) {
                console.error('Unable to update cart item:', error);
                req.flash('error', 'Unable to update item right now.');
                return res.redirect('/cart');
            }

            if (!results.length) {
                req.flash('error', 'Product no longer exists.');
                return res.redirect('/cart');
            }

            const product = results[0];
            const stockCount = Number(product.quantity) || 0;
            const status = product.status || (stockCount > 0 ? 'in_stock' : 'sold_out');

            if (status === 'sold_out' || stockCount <= 0) {
                req.flash('error', 'This product is sold out and has been removed from your cart.');
                req.session.cart = req.session.cart.filter((item) => item.productId !== productId);
                return res.redirect('/cart');
            }

            const safeQty = Math.max(1, Math.min(requestedQty || 1, stockCount));
            cartItem.quantity = safeQty;
            req.flash('success', `${cartItem.productName} quantity updated.`);
            res.redirect('/cart');
        });
    };

    const deleteCartItem = (req, res) => {
        const productId = parseInt(req.params.id, 10);

        if (!req.session.cart) {
            req.flash('error', 'Your cart is empty.');
            return res.redirect('/cart');
        }

        const initialLength = req.session.cart.length;
        req.session.cart = req.session.cart.filter((item) => item.productId !== productId);

        if (req.session.cart.length < initialLength) {
            req.flash('success', 'Item removed from your cart.');
        } else {
            req.flash('error', 'Item not found in your cart.');
        }

        res.redirect('/cart');
    };

    const renderCart = (req, res) => {
        const cart = req.session.cart || [];
        res.render('cart', {
            cart,
            user: req.session.user,
            messages: {
                success: req.flash('success'),
                error: req.flash('error')
            }
        });
    };

    return { addToCart, renderCart, updateCartItem, deleteCartItem };
};

module.exports = createCartController;
