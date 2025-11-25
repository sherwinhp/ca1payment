const createProductController = ({ connection, decorateProduct }) => {
    const renderInventory = (req, res) => {
        connection.query('SELECT * FROM products', (error, results) => {
            if (error) throw error;
            res.render('inventory', {
                products: results,
                user: req.session.user,
                messages: {
                    success: req.flash('success'),
                    error: req.flash('error')
                }
            });
        });
    };

    const renderProductDetails = (req, res) => {
        const currentUser = req.session.user || null;
        const productId = parseInt(req.params.id, 10);
        const singleProductSQL = `
            SELECT p.*, COALESCE(AVG(r.rating), 0) AS averageRating, COUNT(r.id) AS reviewCount
            FROM products p
            LEFT JOIN product_reviews r ON r.product_id = p.id
            WHERE p.id = ?
            GROUP BY p.id
        `;

        connection.query(singleProductSQL, [productId], (error, productResults) => {
            if (error) {
                console.error('Unable to fetch product details:', error);
                return res.status(500).send('Unable to load product right now.');
            }

            if (!productResults.length) {
                return res.status(404).send('Product not found');
            }

            const product = decorateProduct({
                ...productResults[0],
                status: productResults[0].status || (productResults[0].quantity > 0 ? 'in_stock' : 'sold_out')
            });
            const reviewsSQL = `
                SELECT r.id, r.rating, r.review, r.created_at, r.updated_at, r.user_id, r.admin_reply, u.username, u.role
                FROM product_reviews r
                INNER JOIN users u ON u.id = r.user_id
                WHERE r.product_id = ?
                ORDER BY r.updated_at DESC
            `;

            connection.query(reviewsSQL, [productId], (reviewErr, reviewResults) => {
                if (reviewErr) {
                    console.error('Unable to fetch reviews:', reviewErr);
                    return res.status(500).send('Unable to load product reviews right now.');
                }

                const ratingBuckets = [5, 4, 3, 2, 1].map((stars) => ({
                    stars,
                    count: reviewResults.filter((review) => review.rating === stars).length
                }));

                const userReview = currentUser
                    ? reviewResults.find((review) => review.user_id === currentUser.id)
                    : null;

                res.render('product', {
                    product,
                    user: currentUser,
                    reviews: reviewResults,
                    reviewSummary: {
                        total: reviewResults.length,
                        buckets: ratingBuckets
                    },
                    userReview,
                    canReview: !!(currentUser && currentUser.role === 'user'),
                    messages: {
                        errors: req.flash('error'),
                        success: req.flash('success')
                    }
                });
            });
        });
    };

    const renderAddProductForm = (req, res) => {
        res.render('addProduct', {
            user: req.session.user,
            messages: {
                success: req.flash('success'),
                error: req.flash('error')
            }
        });
    };

    const createProduct = (req, res) => {
        const { name, quantity, price } = req.body;
        let image = null;
        const qty = Math.max(0, parseInt(quantity, 10) || 0);
        const priceValue = Number(price);
        const normalizedStatus = qty <= 0 ? 'sold_out' : 'in_stock';

        if (priceValue <= 0) {
            req.flash('error', 'Price must be greater than zero.');
            return res.redirect('/addProduct');
        }

        if (req.file) {
            image = req.file.filename;
        }

        const sql = 'INSERT INTO products (productName, quantity, price, image, status) VALUES (?, ?, ?, ?, ?)';
        connection.query(sql, [name, qty, priceValue, image, normalizedStatus], (error) => {
            if (error) {
                console.error('Error adding product:', error);
                req.flash('error', 'Error adding product.');
                res.redirect('/addProduct');
            } else {
                req.flash('success', 'Product added.');
                res.redirect('/inventory');
            }
        });
    };

    const renderUpdateProductForm = (req, res) => {
        const productId = req.params.id;
        const sql = 'SELECT * FROM products WHERE id = ?';

        connection.query(sql, [productId], (error, results) => {
            if (error) throw error;

            if (results.length > 0) {
                res.render('updateProduct', {
                    product: results[0],
                    user: req.session.user,
                    messages: {
                        success: req.flash('success'),
                        error: req.flash('error')
                    }
                });
            } else {
                res.status(404).send('Product not found');
            }
        });
    };

    const updateProduct = (req, res) => {
        const productId = req.params.id;
        const { name, quantity, price } = req.body;
        let image = req.body.currentImage;
        const qty = Math.max(0, parseInt(quantity, 10) || 0);
        const priceValue = Number(price);
        const normalizedStatus = qty <= 0 ? 'sold_out' : 'in_stock';

        if (priceValue <= 0) {
            req.flash('error', 'Price must be greater than zero.');
            return res.redirect(`/updateProduct/${productId}`);
        }

        if (req.file) {
            image = req.file.filename;
        }

        const sql = 'UPDATE products SET productName = ?, quantity = ?, price = ?, image = ?, status = ? WHERE id = ?';
        connection.query(sql, [name, qty, priceValue, image, normalizedStatus, productId], (error) => {
            if (error) {
                console.error('Error updating product:', error);
                req.flash('error', 'Error updating product.');
                res.redirect(`/updateProduct/${productId}`);
            } else {
                req.flash('success', 'Product updated.');
                res.redirect('/inventory');
            }
        });
    };

    const deleteProduct = (req, res) => {
        const productId = req.params.id;

        // Soft-delete to preserve order history: mark sold out and zero stock
        connection.query(
            `
                UPDATE products
                SET quantity = 0, status = 'sold_out'
                WHERE id = ?
            `,
            [productId],
            (error, result) => {
                if (error) {
                    console.error('Error deleting product:', error);
                    req.flash('error', 'Error deleting product.');
                } else if (!result.affectedRows) {
                    req.flash('error', 'Product not found.');
                } else {
                    req.flash('success', 'Product archived (sold out) to preserve order history.');
                }
                res.redirect('/inventory');
            }
        );
    };

    return {
        renderInventory,
        renderProductDetails,
        renderAddProductForm,
        createProduct,
        renderUpdateProductForm,
        updateProduct,
        deleteProduct
    };
};

module.exports = createProductController;
