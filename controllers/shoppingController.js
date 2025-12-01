const createShoppingController = ({ connection, decorateProduct }) => {
    const renderShopping = (req, res) => {
        const searchTerm = (req.query.search || '').trim();
        const categoryFilter = (req.query.category || '').trim();
        const sortKey = (req.query.sort || '').toLowerCase();
        const allowedSorts = {
            name_asc: 'p.productName ASC',
            name_desc: 'p.productName DESC',
            price_asc: 'p.price ASC',
            price_desc: 'p.price DESC'
        };
        const orderClause =
            allowedSorts[sortKey] || 'status ASC, averageRating DESC, reviewCount DESC, p.productName ASC';

        let shoppingSQL = `
            SELECT
                p.id,
                p.productName,
                p.quantity,
                p.price,
                p.image,
                p.category,
                CASE
                    WHEN p.quantity <= 0 THEN 'sold_out'
                    WHEN p.quantity < 10 THEN 'low_stock'
                    ELSE 'in_stock'
                END AS status,
                COALESCE(AVG(r.rating), 0) AS averageRating,
                COUNT(r.id) AS reviewCount
            FROM products p
            LEFT JOIN product_reviews r ON r.product_id = p.id
            WHERE p.is_deleted = 0
        `;

        const queryParams = [];
        if (searchTerm) {
            shoppingSQL += ' AND p.productName LIKE ?';
            queryParams.push(`%${searchTerm}%`);
        }

        if (categoryFilter) {
            shoppingSQL += ' AND p.category = ?';
            queryParams.push(categoryFilter);
        }

        shoppingSQL += `
            GROUP BY p.id
            ORDER BY ${orderClause}
        `;

        const categoriesSQL = `
            SELECT DISTINCT category
            FROM products
            WHERE is_deleted = 0 AND category IS NOT NULL AND category <> ''
            ORDER BY category ASC
        `;

        connection.query(categoriesSQL, (catErr, categoryRows) => {
            const categoryOptions = catErr ? [] : categoryRows.map((row) => row.category);

            connection.query(shoppingSQL, queryParams, (error, results) => {
                if (error) {
                    console.error('Unable to load products for shopping page:', error, { sql: shoppingSQL, params: queryParams });
                    return res.render('shopping', {
                        user: req.session.user,
                        products: [],
                        categories: categoryOptions,
                        selectedCategory: categoryFilter,
                        shoppingError: 'We could not load the catalog right now. Please try again soon.',
                        messages: { success: req.flash('success'), error: req.flash('error') }
                    });
                }

                const decoratedProducts = results.map(decorateProduct);
                res.render('shopping', {
                    user: req.session.user,
                    products: decoratedProducts,
                    categories: categoryOptions,
                    selectedCategory: categoryFilter,
                    searchTerm,
                    sortKey,
                    shoppingError: decoratedProducts.length ? null : 'No produce available yet. Please check back later.',
                    messages: { success: req.flash('success'), error: req.flash('error') }
                });
            });
        });
    };

    return { renderShopping };
};

module.exports = createShoppingController;
