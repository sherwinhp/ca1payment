const createReviewModel = require('../models/reviewModel');

const createReviewController = ({ connection, models = {} }) => {
    const reviewModel = models.reviewModel || createReviewModel(connection);

    const submitProductReview = (req, res) => {
        const productId = parseInt(req.params.id, 10);
        const { rating, reviewText } = req.body;
        const sessionUser = req.session.user;

        if (!sessionUser) {
            req.flash('error', 'Please log in to leave a review.');
            return res.redirect(`/login`);
        }

        if (sessionUser.role !== 'user') {
            req.flash('error', 'Only registered shoppers can submit reviews.');
            return res.redirect(`/product/${productId}#reviews`);
        }

        const numericRating = Math.max(1, Math.min(5, parseInt(rating, 10) || 0));
        if (!numericRating) {
            req.flash('error', 'Please choose a rating between 1 and 5 stars.');
            return res.redirect(`/product/${productId}#review-form`);
        }

        const sanitizedReview = reviewText ? reviewText.trim() : '';

        reviewModel.upsertReview(
            { productId, userId: sessionUser.id, rating: numericRating, review: sanitizedReview },
            (error) => {
            if (error) {
                console.error('Unable to save review:', error);
                req.flash('error', 'We could not save your review right now. Please try again later.');
            } else {
                req.flash('success', 'Thanks for sharing your thoughts with the community!');
            }

            res.redirect(`/product/${productId}#reviews`);
            }
        );
    };

    const fetchReviewProductId = (reviewId, callback) => {
        const fetchSQL = 'SELECT product_id FROM product_reviews WHERE id = ?';
        connection.query(fetchSQL, [reviewId], (err, rows = []) => {
            if (err) {
                console.error('Unable to locate review product:', err);
                return callback(null);
            }
            const productId = rows[0] ? rows[0].product_id : null;
            callback(productId);
        });
    };

    const redirectToReviewProduct = (productId, res, fallback = '/inventory') => {
        if (productId) {
            return res.redirect(`/product/${productId}#reviews`);
        }
        return res.redirect(fallback);
    };

    const deleteReview = (req, res) => {
        const reviewId = parseInt(req.params.id, 10);
        const sessionUser = req.session.user;
        const formProductId = parseInt(req.body.productId, 10);
        const referer = req.get('referer') || '';

        const redirectBack = (productId) => {
            const target = productId || formProductId || null;
            if (target) {
                return redirectToReviewProduct(target, res);
            }
            if (referer) {
                return res.redirect(referer);
            }
            return res.redirect('/inventory');
        };

        if (!sessionUser || sessionUser.role !== 'admin') {
            req.flash('error', 'Only admins can delete reviews.');
            return redirectBack(formProductId);
        }

        fetchReviewProductId(reviewId, (productId) => {
            reviewModel.deleteReview(reviewId, (error) => {
                if (error) {
                    console.error('Unable to delete review:', error);
                    req.flash('error', 'Unable to delete review right now.');
                } else {
                    req.flash('success', 'Review deleted.');
                }
                redirectBack(productId);
            });
        });
    };

    const replyToReview = (req, res) => {
        const reviewId = parseInt(req.params.id, 10);
        const reply = (req.body.reply || '').trim();
        const sessionUser = req.session.user;
        const formProductId = parseInt(req.body.productId, 10);
        const referer = req.get('referer') || '';

        const redirectBack = (productId) => {
            const target = productId || formProductId || null;
            if (target) {
                return redirectToReviewProduct(target, res);
            }
            if (referer) {
                return res.redirect(referer);
            }
            return res.redirect('/inventory');
        };

        if (!sessionUser || sessionUser.role !== 'admin') {
            req.flash('error', 'Only admins can reply to reviews.');
            return redirectBack(formProductId);
        }

        fetchReviewProductId(reviewId, (productId) => {
            reviewModel.replyToReview({ reviewId, reply }, (error, result) => {
                if (error) {
                    console.error('Unable to save reply:', error);
                    req.flash('error', 'Unable to save reply right now.');
                } else if (!result.affectedRows) {
                    req.flash('error', 'Review not found.');
                } else {
                    req.flash('success', 'Reply saved.');
                }
                redirectBack(productId);
            });
        });
    };

    return { submitProductReview, deleteReview, replyToReview };
};

module.exports = createReviewController;
