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

    const deleteReview = (req, res) => {
        const reviewId = parseInt(req.params.id, 10);
        const sessionUser = req.session.user;

        if (!sessionUser || sessionUser.role !== 'admin') {
            req.flash('error', 'Only admins can delete reviews.');
            return res.redirect('back');
        }

        reviewModel.deleteReview(reviewId, (error) => {
            if (error) {
                console.error('Unable to delete review:', error);
                req.flash('error', 'Unable to delete review right now.');
            } else {
                req.flash('success', 'Review deleted.');
            }
            res.redirect('back');
        });
    };

    const replyToReview = (req, res) => {
        const reviewId = parseInt(req.params.id, 10);
        const reply = (req.body.reply || '').trim();
        const sessionUser = req.session.user;

        if (!sessionUser || sessionUser.role !== 'admin') {
            req.flash('error', 'Only admins can reply to reviews.');
            return res.redirect('back');
        }

        reviewModel.replyToReview({ reviewId, reply }, (error, result) => {
            if (error) {
                console.error('Unable to save reply:', error);
                req.flash('error', 'Unable to save reply right now.');
            } else if (!result.affectedRows) {
                req.flash('error', 'Review not found.');
            } else {
                req.flash('success', 'Reply saved.');
            }
            res.redirect('back');
        });
    };

    return { submitProductReview, deleteReview, replyToReview };
};

module.exports = createReviewController;
