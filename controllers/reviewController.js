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

    const deleteReview = (req, res) => {
        const reviewId = parseInt(req.params.id, 10);
        const sessionUser = req.session.user;

        if (!sessionUser || sessionUser.role !== 'admin') {
            req.flash('error', 'Only admins can delete reviews.');
            return res.redirect('back');
        }

        connection.query('DELETE FROM product_reviews WHERE id = ?', [reviewId], (error) => {
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

        connection.query(
            'UPDATE product_reviews SET admin_reply = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [reply, reviewId],
            (error, result) => {
                if (error) {
                    console.error('Unable to save reply:', error);
                    req.flash('error', 'Unable to save reply right now.');
                } else if (!result.affectedRows) {
                    req.flash('error', 'Review not found.');
                } else {
                    req.flash('success', 'Reply saved.');
                }
                res.redirect('back');
            }
        );
    };

    return { submitProductReview, deleteReview, replyToReview };
};

module.exports = createReviewController;
