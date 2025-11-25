const createShoppingController = ({ connection, decorateProduct }) => {
    const renderShopping = (req, res) => {
        const shoppingSQL = `
            SELECT p.*, COALESCE(AVG(r.rating), 0) AS averageRating, COUNT(r.id) AS reviewCount
            FROM products p
            LEFT JOIN product_reviews r ON r.product_id = p.id
            GROUP BY p.id
            ORDER BY p.productName ASC
        `;

        connection.query(shoppingSQL, (error, results) => {
            if (error) {
                console.error('Unable to load products for shopping page:', error);
                return res.render('shopping', {
                    user: req.session.user,
                    products: [],
                    shoppingError: 'We could not load the catalog right now. Please try again soon.',
                    messages: { success: req.flash('success'), error: req.flash('error') }
                });
            }

            const decoratedProducts = results.map(decorateProduct);
            res.render('shopping', {
                user: req.session.user,
                products: decoratedProducts,
                shoppingError: decoratedProducts.length ? null : 'No produce available yet. Please check back later.',
                messages: { success: req.flash('success'), error: req.flash('error') }
            });
        });
    };

    return { renderShopping };
};

module.exports = createShoppingController;
