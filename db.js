const mysql = require('mysql2');
require('dotenv').config(); // Load variables from .env

// Database connection details
const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

// Helper to ensure tables/seeds exist
const initializeDatabase = ({ primaryAdminEmail, primaryAdminPassword, primaryAdminProfile }) => {
    const ensureReviewInfrastructure = () => {
        const createReviewTableSQL = `
            CREATE TABLE IF NOT EXISTS product_reviews (
                id INT AUTO_INCREMENT PRIMARY KEY,
                product_id INT NOT NULL,
                user_id INT NOT NULL,
                rating TINYINT NOT NULL,
                review TEXT,
                admin_reply TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_product_user (product_id, user_id),
                CONSTRAINT fk_reviews_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
                CONSTRAINT fk_reviews_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `;

        connection.query(createReviewTableSQL, (tableErr) => {
            if (tableErr) {
                console.error('Unable to prepare reviews table:', tableErr);
            } else {
                const columnCheckSQL = `
                    SELECT COUNT(*) AS hasColumn
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'product_reviews'
                      AND COLUMN_NAME = 'admin_reply'
                `;
                connection.query(columnCheckSQL, (checkErr, rows = []) => {
                    if (checkErr) {
                        console.error('Unable to verify admin_reply column:', checkErr);
                        return;
                    }
                    const exists = rows[0] && rows[0].hasColumn;
                    if (!exists) {
                        connection.query('ALTER TABLE product_reviews ADD COLUMN admin_reply TEXT NULL', (alterErr) => {
                            if (alterErr) {
                                console.error('Unable to add admin_reply column:', alterErr);
                            } else {
                                console.log('Added admin_reply column to product_reviews');
                            }
                        });
                    }
                });
            }
        });
    };

    const ensureCartInfrastructure = () => {
        const createCartTableSQL = `
            CREATE TABLE IF NOT EXISTS cart_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                product_id INT NOT NULL,
                quantity INT NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_user_product (user_id, product_id),
                CONSTRAINT fk_cart_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_cart_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
            )
        `;

        connection.query(createCartTableSQL, (tableErr) => {
            if (tableErr) {
                console.error('Unable to prepare cart table:', tableErr);
            }
        });
    };

    const ensureOrderItemSnapshots = () => {
        const columns = [
            { name: 'product_name_snapshot', ddl: 'ALTER TABLE order_items ADD COLUMN product_name_snapshot VARCHAR(255) NULL' },
            { name: 'product_image_snapshot', ddl: 'ALTER TABLE order_items ADD COLUMN product_image_snapshot VARCHAR(255) NULL' }
        ];

        columns.forEach((col) => {
            const sql = `
                SELECT COUNT(*) AS hasColumn
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'order_items'
                  AND COLUMN_NAME = ?
            `;
            connection.query(sql, [col.name], (checkErr, rows = []) => {
                if (checkErr) {
                    return console.error(`Unable to check ${col.name} column:`, checkErr);
                }
                const exists = rows[0] && rows[0].hasColumn;
                if (!exists) {
                    connection.query(col.ddl, (alterErr) => {
                        if (alterErr) {
                            console.error(`Unable to add ${col.name} column:`, alterErr);
                        } else {
                            console.log(`Added ${col.name} to order_items`);
                        }
                    });
                }
            });
        });
    };

    const normalizeOrderStatuses = () => {
        connection.query("UPDATE orders SET status = 'pending' WHERE status = 'placed'", (err) => {
            if (err) {
                console.error('Unable to normalize order statuses:', err);
            }
        });
    };

    const ensureOrderInfrastructure = () => {
        const createOrdersTableSQL = `
            CREATE TABLE IF NOT EXISTS orders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                total_amount DECIMAL(10,2) NOT NULL,
                payment_method VARCHAR(50) NOT NULL,
                status VARCHAR(50) NOT NULL DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `;

        const createOrderItemsTableSQL = `
            CREATE TABLE IF NOT EXISTS order_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                order_id INT NOT NULL,
                product_id INT NOT NULL,
                product_name_snapshot VARCHAR(255) NULL,
                product_image_snapshot VARCHAR(255) NULL,
                quantity INT NOT NULL,
                price_at_purchase DECIMAL(10,2) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_orderitems_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
                CONSTRAINT fk_orderitems_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
            )
        `;

        connection.query(createOrdersTableSQL, (ordersErr) => {
            if (ordersErr) {
                return console.error('Unable to prepare orders table:', ordersErr);
            }
            connection.query(createOrderItemsTableSQL, (itemsErr) => {
                if (itemsErr) {
                    console.error('Unable to prepare order items table:', itemsErr);
                } else {
                    ensureOrderItemSnapshots();
                    normalizeOrderStatuses();
                }
            });
        });
    };

    const ensureProductStatusColumn = (done = () => {}) => {
        const columnCheckSQL = `
            SELECT DATA_TYPE, COLUMN_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'products'
              AND COLUMN_NAME = 'status'
        `;

        connection.query(columnCheckSQL, (checkErr, results = []) => {
            if (checkErr) {
                console.error('Unable to validate product status column:', checkErr);
                return done();
            }

            const hasStatusColumn = results.length > 0;
            const needsEnumUpdate =
                hasStatusColumn && results[0].COLUMN_TYPE.indexOf('low_stock') === -1;

            const normalizeStatuses = () => {
                connection.query(
                    `
                        UPDATE products
                        SET status = CASE
                            WHEN quantity <= 0 THEN 'sold_out'
                            WHEN quantity < 10 THEN 'low_stock'
                            ELSE 'in_stock'
                        END
                    `,
                    (updateErr) => {
                        if (updateErr) {
                            console.error('Unable to hydrate product status values:', updateErr);
                        }
                        done();
                    }
                );
            };

            if (hasStatusColumn && !needsEnumUpdate) {
                return normalizeStatuses();
            }

            const alterProductSQL = hasStatusColumn
                ? `
                    ALTER TABLE products
                    MODIFY status ENUM('in_stock', 'low_stock', 'sold_out') NOT NULL DEFAULT 'in_stock'
                  `
                : `
                    ALTER TABLE products
                    ADD COLUMN status ENUM('in_stock', 'low_stock', 'sold_out') NOT NULL DEFAULT 'in_stock'
                  `;

            connection.query(alterProductSQL, (error) => {
                if (error) {
                    console.error('Unable to ensure product status column exists:', error);
                    return done();
                }
                normalizeStatuses();
            });
        });
    };

    const ensureProductCategoryColumn = (done = () => {}) => {
        const columnCheckSQL = `
            SELECT COUNT(*) AS columnExists
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'products'
              AND COLUMN_NAME = 'category'
        `;

        connection.query(columnCheckSQL, (checkErr, results = []) => {
            if (checkErr) {
                console.error('Unable to validate product category column:', checkErr);
                return done();
            }

            const hasColumn = results[0] && results[0].columnExists;
            if (hasColumn) {
                return done();
            }

            const alterSQL = `
                ALTER TABLE products
                ADD COLUMN category VARCHAR(100) NOT NULL DEFAULT 'General' AFTER image
            `;
            connection.query(alterSQL, (alterErr) => {
                if (alterErr) {
                    console.error('Unable to add product category column:', alterErr);
                }
                done();
            });
        });
    };

    const ensureProductDeleteFlag = (done = () => {}) => {
        const columnCheckSQL = `
            SELECT COUNT(*) AS columnExists
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'products'
              AND COLUMN_NAME = 'is_deleted'
        `;

        connection.query(columnCheckSQL, (checkErr, results = []) => {
            if (checkErr) {
                console.error('Unable to validate product deletion flag:', checkErr);
                return done();
            }

            const hasColumn = results[0] && results[0].columnExists;
            if (hasColumn) {
                return done();
            }

            const alterSQL = `
                ALTER TABLE products
                ADD COLUMN is_deleted TINYINT(1) NOT NULL DEFAULT 0
            `;
            connection.query(alterSQL, (alterErr) => {
                if (alterErr) {
                    console.error('Unable to add product deletion flag:', alterErr);
                }
                done();
            });
        });
    };

    const ensureShowcaseProducts = () => {
        const showcaseProducts = [
            { productName: 'Oranges', quantity: 60, price: 3.5, image: 'oranges.jpg', status: 'in_stock' },
            { productName: 'Durian', quantity: 18, price: 18.0, image: 'durian.jpg', status: 'in_stock' },
            { productName: 'Blueberries', quantity: 45, price: 4.9, image: 'blueberry.jpg', status: 'in_stock' }
        ];

        const productNames = showcaseProducts.map((item) => item.productName);
        const existingSQL = 'SELECT productName FROM products WHERE productName IN (?)';

        connection.query(existingSQL, [productNames], (existingErr, existingResults = []) => {
            if (existingErr) {
                return console.error('Unable to verify showcase products:', existingErr);
            }

            const existingNames = new Set(existingResults.map((row) => (row.productName || '').toLowerCase()));
            const missingProducts = showcaseProducts.filter(
                (item) => !existingNames.has(item.productName.toLowerCase())
            );

            if (!missingProducts.length) {
                return;
            }

            const placeholders = missingProducts.map(() => '(?, ?, ?, ?, ?)').join(', ');
            const values = missingProducts.flatMap((item) => [
                item.productName,
                item.quantity,
                item.price,
                item.image,
                item.status
            ]);

            const insertSQL = `INSERT INTO products (productName, quantity, price, image, status) VALUES ${placeholders}`;

            connection.query(insertSQL, values, (insertErr) => {
                if (insertErr) {
                    console.error('Unable to seed showcase products:', insertErr);
                }
            });
        });
    };

    const ensurePrimaryAdmin = () => {
        const insertPrimaryAdminSQL = `
            INSERT INTO users (username, email, password, address, contact, role)
            SELECT ?, ?, SHA1(?), ?, ?, 'admin'
            WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = ?)
        `;

        connection.query(
            insertPrimaryAdminSQL,
            [
                primaryAdminProfile.username,
                primaryAdminEmail,
                primaryAdminPassword,
                primaryAdminProfile.address,
                primaryAdminProfile.contact,
                primaryAdminEmail
            ],
            (error) => {
                if (error) {
                    console.error('Unable to seed the primary admin account:', error);
                }
            }
        );
    };

    ensureReviewInfrastructure();
    ensureCartInfrastructure();
    ensureOrderInfrastructure();
    ensureProductStatusColumn(() => {
        ensureProductCategoryColumn(() => {
            ensureProductDeleteFlag(() => {
                ensureShowcaseProducts();
            });
        });
    });
    ensurePrimaryAdmin();
};

module.exports = { connection, initializeDatabase };
