const createReviewModel = (connection) => {
    const upsertReview = ({ productId, userId, rating, review }, callback) => {
        const sql = `
            INSERT INTO product_reviews (product_id, user_id, rating, review)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE rating = VALUES(rating), review = VALUES(review), updated_at = CURRENT_TIMESTAMP
        `;
        connection.query(sql, [productId, userId, rating, review], callback);
    };

    const deleteReview = (reviewId, callback) => {
        connection.query('DELETE FROM product_reviews WHERE id = ?', [reviewId], callback);
    };

    const replyToReview = ({ reviewId, reply }, callback) => {
        const sql = 'UPDATE product_reviews SET admin_reply = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
        connection.query(sql, [reply, reviewId], callback);
    };

    const getByProduct = (productId, callback) => {
        const sql = `
            SELECT r.id, r.rating, r.review, r.created_at, r.updated_at, r.user_id, r.admin_reply, u.username, u.role
            FROM product_reviews r
            INNER JOIN users u ON u.id = r.user_id
            WHERE r.product_id = ?
            ORDER BY r.updated_at DESC
        `;
        connection.query(sql, [productId], callback);
    };

    return {
        upsertReview,
        deleteReview,
        replyToReview,
        getByProduct
    };
};

module.exports = createReviewModel;
