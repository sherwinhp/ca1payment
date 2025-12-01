const createProductModel = require('../models/productModel');
const createReviewModel = require('../models/reviewModel');

const createProductController = ({ connection, decorateProduct, models = {} }) => {
    const productModel = models.productModel || createProductModel(connection);
    const reviewModel = models.reviewModel || createReviewModel(connection);
    const computeStatus = (qty) => {
        if (qty <= 0) return 'sold_out';
        if (qty < 10) return 'low_stock';
        return 'in_stock';
    };

    const renderInventory = (req, res) => {
        productModel.getAll((error, results) => {
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

        productModel.getWithStats(productId, (error, productResults) => {
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
            reviewModel.getByProduct(productId, (reviewErr, reviewResults) => {
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
        const category = (req.body.category || 'General').trim() || 'General';
        let image = null;
        const qty = Math.max(0, parseInt(quantity, 10) || 0);
        const priceValue = Number(price);
        const normalizedStatus = computeStatus(qty);

        if (priceValue <= 0) {
            req.flash('error', 'Price must be greater than zero.');
            return res.redirect('/addProduct');
        }

        if (req.file) {
            image = req.file.filename;
        }

        productModel.create(
            { name, quantity: qty, price: priceValue, image, status: normalizedStatus, category },
            (error) => {
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

        productModel.getById(productId, (error, results) => {
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
        const category = (req.body.category || 'General').trim() || 'General';
        let image = req.body.currentImage;
        const qty = Math.max(0, parseInt(quantity, 10) || 0);
        const priceValue = Number(price);
        const normalizedStatus = computeStatus(qty);

        if (priceValue <= 0) {
            req.flash('error', 'Price must be greater than zero.');
            return res.redirect(`/updateProduct/${productId}`);
        }

        if (req.file) {
            image = req.file.filename;
        }

        productModel.update(
            { id: productId, name, quantity: qty, price: priceValue, image, status: normalizedStatus, category },
            (error) => {
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
        productModel.softDelete(productId, (error, result) => {
            if (error) {
                console.error('Error deleting product:', error);
                req.flash('error', 'Error deleting product.');
            } else if (!result.affectedRows) {
                req.flash('error', 'Product not found.');
            } else {
                req.flash('success', 'Product archived (sold out) to preserve order history.');
            }
            res.redirect('/inventory');
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
