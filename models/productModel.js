const createProductModel = (connection) => {
    const getAll = (callback) => {
        const sql = `
            SELECT
                p.*,
                CASE WHEN p.quantity <= 0 THEN 'sold_out' ELSE 'in_stock' END AS status
            FROM products p
            WHERE p.is_deleted = 0
        `;
        connection.query(sql, callback);
    };

    const getWithStats = (productId, callback) => {
        const sql = `
            SELECT
                p.*,
                CASE WHEN p.quantity <= 0 THEN 'sold_out' ELSE 'in_stock' END AS status,
                COALESCE(AVG(r.rating), 0) AS averageRating,
                COUNT(r.id) AS reviewCount
            FROM products p
            LEFT JOIN product_reviews r ON r.product_id = p.id
            WHERE p.id = ? AND p.is_deleted = 0
            GROUP BY p.id
        `;
        connection.query(sql, [productId], callback);
    };

    const getReviewsForProduct = (productId, callback) => {
        const sql = `
            SELECT r.id, r.rating, r.review, r.created_at, r.updated_at, r.user_id, r.admin_reply, u.username, u.role
            FROM product_reviews r
            INNER JOIN users u ON u.id = r.user_id
            WHERE r.product_id = ?
            ORDER BY r.updated_at DESC
        `;
        connection.query(sql, [productId], callback);
    };

    const getById = (productId, callback) => {
        const sql = `
            SELECT
                p.*,
                CASE WHEN p.quantity <= 0 THEN 'sold_out' ELSE 'in_stock' END AS status
            FROM products p
            WHERE p.id = ? AND p.is_deleted = 0
        `;
        connection.query(sql, [productId], callback);
    };

    const create = ({ name, quantity, price, image, status }, callback) => {
        const sql = 'INSERT INTO products (productName, quantity, price, image, status) VALUES (?, ?, ?, ?, ?)';
        connection.query(sql, [name, quantity, price, image, status], callback);
    };

    const update = ({ id, name, quantity, price, image, status }, callback) => {
        const sql = 'UPDATE products SET productName = ?, quantity = ?, price = ?, image = ?, status = ? WHERE id = ?';
        connection.query(sql, [name, quantity, price, image, status, id], callback);
    };

    const softDelete = (productId, callback) => {
        const sql = `
            UPDATE products
            SET quantity = 0, status = 'sold_out', is_deleted = 1
            WHERE id = ?
        `;
        connection.query(sql, [productId], callback);
    };

    return {
        getAll,
        getWithStats,
        getReviewsForProduct,
        getById,
        create,
        update,
        softDelete
    };
};

module.exports = createProductModel;
