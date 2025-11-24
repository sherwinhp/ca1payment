const createHomeController = ({ connection, heroCopy, decorateProduct }) => {
    const hiddenHomepageProducts = new Set(['oranges', 'durian', 'blueberries']);

    const renderHomePage = (req, res) => {
        const featuredSQL = `
            SELECT p.*, COALESCE(AVG(r.rating), 0) AS averageRating, COUNT(r.id) AS reviewCount
            FROM products p
            LEFT JOIN product_reviews r ON r.product_id = p.id
            GROUP BY p.id
            ORDER BY p.productName ASC
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
