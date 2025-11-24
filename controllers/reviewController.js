const createReviewController = ({ connection }) => {
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
        const upsertSQL = `
            INSERT INTO product_reviews (product_id, user_id, rating, review)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE rating = VALUES(rating), review = VALUES(review), updated_at = CURRENT_TIMESTAMP
        `;

        connection.query(upsertSQL, [productId, sessionUser.id, numericRating, sanitizedReview], (error) => {
            if (error) {
                console.error('Unable to save review:', error);
                req.flash('error', 'We could not save your review right now. Please try again later.');
            } else {
                req.flash('success', 'Thanks for sharing your thoughts with the community!');
            }

            res.redirect(`/product/${productId}#reviews`);
        });
    };

    return { submitProductReview };
};

module.exports = createReviewController;
