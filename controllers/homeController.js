const createHomeController = ({ connection, heroCopy, decorateProduct }) => {
    const hiddenHomepageProducts = new Set(['oranges', 'durian', 'blueberries']);

    const renderHomePage = (req, res) => {
        const featuredSQL = `
            SELECT
                p.*,
                CASE
                    WHEN p.quantity <= 0 THEN 'sold_out'
                    WHEN p.quantity < 10 THEN 'low_stock'
                    ELSE 'in_stock'
                END AS status,
                COALESCE(AVG(r.rating), 0) AS averageRating,
                COUNT(r.id) AS reviewCount
            FROM products p
            LEFT JOIN product_reviews r ON r.product_id = p.id
            WHERE p.quantity > 0 AND p.is_deleted = 0
            GROUP BY p.id
            ORDER BY averageRating DESC, reviewCount DESC, p.productName ASC
            LIMIT 8
        `;

        connection.query(featuredSQL, (error, results) => {
            if (error) {
                console.error('Unable to load featured products:', error);
                return res.render('index', {
                    user: req.session.user,
                    featuredProducts: [],
                    heroCopy,
                    alerts: ['We are refreshing our shelves. Please check back shortly!']
                });
            }

            const featuredProducts = results
                .map(decorateProduct)
                .filter((product) => !hiddenHomepageProducts.has((product.productName || '').toLowerCase()));
            res.render('index', {
                user: req.session.user,
                featuredProducts,
                heroCopy,
                alerts: []
            });
        });
    };

    return { renderHomePage };
};

module.exports = createHomeController;
