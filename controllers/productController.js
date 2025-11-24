const createProductController = ({ connection, decorateProduct }) => {
    const renderInventory = (req, res) => {
        connection.query('SELECT * FROM products', (error, results) => {
            if (error) throw error;
            res.render('inventory', { products: results, user: req.session.user });
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
                SELECT r.id, r.rating, r.review, r.created_at, r.updated_at, r.user_id, u.username, u.role
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
        res.render('addProduct', { user: req.session.user });
    };

    const createProduct = (req, res) => {
        const { name, quantity, price, status } = req.body;
        let image = null;
        const normalizedStatus = status === 'sold_out' ? 'sold_out' : 'in_stock';

        if (req.file) {
            image = req.file.filename;
        }

        const sql = 'INSERT INTO products (productName, quantity, price, image, status) VALUES (?, ?, ?, ?, ?)';
        connection.query(sql, [name, quantity, price, image, normalizedStatus], (error) => {
            if (error) {
                console.error('Error adding product:', error);
                res.status(500).send('Error adding product');
            } else {
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
                res.render('updateProduct', { product: results[0], user: req.session.user });
            } else {
                res.status(404).send('Product not found');
            }
        });
    };

    const updateProduct = (req, res) => {
        const productId = req.params.id;
        const { name, quantity, price, status } = req.body;
        let image = req.body.currentImage;
        const normalizedStatus = status === 'sold_out' ? 'sold_out' : 'in_stock';

        if (req.file) {
            image = req.file.filename;
        }

        const sql = 'UPDATE products SET productName = ?, quantity = ?, price = ?, image = ?, status = ? WHERE id = ?';
        connection.query(sql, [name, quantity, price, image, normalizedStatus, productId], (error) => {
            if (error) {
                console.error('Error updating product:', error);
                res.status(500).send('Error updating product');
            } else {
                res.redirect('/inventory');
            }
        });
    };

    const deleteProduct = (req, res) => {
        const productId = req.params.id;

        connection.query('DELETE FROM products WHERE id = ?', [productId], (error) => {
            if (error) {
                console.error('Error deleting product:', error);
                res.status(500).send('Error deleting product');
            } else {
                res.redirect('/inventory');
            }
        });
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
