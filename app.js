const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const createHomeController = require('./controllers/homeController');
const createAuthController = require('./controllers/authController');
const createShoppingController = require('./controllers/shoppingController');
const createCartController = require('./controllers/cartController');
const createProductController = require('./controllers/productController');
const createReviewController = require('./controllers/reviewController');
const createAdminController = require('./controllers/adminController');
const createModels = require('./models/Supermarket');
const app = express();

const PRIMARY_ADMIN_EMAIL = '24046565@myrp.edu.sg';
const PRIMARY_ADMIN_PASSWORD = '1234567';
const PRIMARY_ADMIN_PROFILE = {
    username: 'Supermarket Director',
    address: 'Republic Polytechnic',
    contact: '00000000'
};

// Lightweight copy deck to enrich produce cards without extra DB columns
const productShowcaseCopy = {
    apples: {
        tagline: 'Lunchbox hero',
        description: 'Naturally sweet Honeycrisp apples picked at peak ripeness for a juicy crunch in every bite.',
        tastingNotes: 'Bright, crisp and gently floral.',
        highlights: ['Rich in Vitamin C', 'Hand-graded for quality'],
        accentColor: 'success'
    },
    bananas: {
        tagline: 'Energy booster',
        description: 'Sun-ripened Cavendish bananas perfect for smoothies, baking or a pre-workout snack.',
        tastingNotes: 'Creamy texture with mellow sweetness.',
        highlights: ['High in potassium', 'Low food miles'],
        accentColor: 'warning'
    },
    broccoli: {
        tagline: 'Weekly greens',
        description: 'Tender florets from local hydroponic farms that roast beautifully or disappear into stir-fries.',
        tastingNotes: 'Earthy with peppery bite.',
        highlights: ['Packed with fibre', 'Great for meal prep'],
        accentColor: 'success'
    },
    bread: {
        tagline: 'Baked daily',
        description: 'Golden sourdough loaves with a crackly crust and soft, chewy centre.',
        tastingNotes: 'Subtle tang with nutty aroma.',
        highlights: ['Naturally leavened', 'No preservatives'],
        accentColor: 'secondary'
    },
    milk: {
        tagline: 'Breakfast essential',
        description: 'Farm-fresh milk that is gently pasteurised to keep things creamy and wholesome.',
        tastingNotes: 'Silky mouthfeel, subtly sweet.',
        highlights: ['Source-certified dairies', 'Great for barista-style foam'],
        accentColor: 'primary'
    },
    tomatoes: {
        tagline: 'Salad ready',
        description: 'Vine tomatoes bursting with flavour that brighten salads, sandwiches and pastas.',
        tastingNotes: 'Sweet with balanced acidity.',
        highlights: ['Naturally ripened', 'Perfect for roasting'],
        accentColor: 'danger'
    },
    oranges: {
        tagline: 'Citrus sunshine',
        description: 'Zesty, juicy oranges ideal for fresh juice or brightening up breakfast.',
        tastingNotes: 'Refreshing acidity with natural sweetness.',
        highlights: ['Vitamin C boost', 'Perfect for juicing'],
        accentColor: 'warning'
    },
    durian: {
        tagline: 'King of fruits',
        description: 'Creamy, aromatic durian for bold dessert experiments and durian fans alike.',
        tastingNotes: 'Custardy texture with deep, complex aroma.',
        highlights: ['Premium grade', 'Chilled delivery'],
        accentColor: 'secondary'
    },
    blueberries: {
        tagline: 'Berry burst',
        description: 'Plump blueberries that sweeten smoothies, pancakes and yoghurts.',
        tastingNotes: 'Sweet with a lively tart finish.',
        highlights: ['Great for cereals', 'Easy grab-and-go snack'],
        accentColor: 'primary'
    }
};

const heroCopy = {
    heading: 'Farm-fresh goodness delivered daily',
    subheading: 'Discover produce with transparent ratings, curated descriptions and easy checkout.',
    perks: [
        'Curated from trusted farms every sunrise',
        'Shopper reviews keep quality honest',
        'Same-day collection available before 6 PM'
    ]
};

const decorateProduct = (productRow = {}) => {
    const key = (productRow.productName || '').toLowerCase();
    const copy = productShowcaseCopy[key] || {};
    const priceNumber = Number(productRow.price || 0);
    const ratingValue = Number(productRow.averageRating || 0);
    const status = productRow.status || (Number(productRow.quantity) > 0 ? 'in_stock' : 'sold_out');
    const isSoldOut = status === 'sold_out' || Number(productRow.quantity) <= 0;

    return {
        ...productRow,
        status,
        isSoldOut,
        showcaseTag: copy.tagline || 'Fresh pick',
        accentColor: copy.accentColor || 'success',
        shortDescription: productRow.description || copy.description || 'Freshly picked produce from trusted growers.',
        tastingNotes: copy.tastingNotes || '',
        highlights: copy.highlights || ['Quality checked', 'Ready for checkout'],
        priceLabel: priceNumber ? priceNumber.toFixed(2) : '0.00',
        ratingValue,
        averageRating: ratingValue ? ratingValue.toFixed(1) : '0.0',
        reviewCount: productRow.reviewCount || 0
    };
};

// Set up multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images'); // Directory to save uploaded files
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname); 
    }
});

const upload = multer({ storage: storage });

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Republic_C207',
    database: 'c372_supermarketdb'
});

const models = createModels(connection);

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
            console.log('Review infrastructure ready');
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
        } else {
            console.log('Cart infrastructure ready');
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
                console.log('Order infrastructure ready');
                ensureOrderItemSnapshots();
                normalizeOrderStatuses();
            }
        });
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

const ensureProductStatusColumn = (done = () => {}) => {
    const columnCheckSQL = `
        SELECT COUNT(*) AS columnExists
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

        const hasStatusColumn = results[0] && results[0].columnExists;
        if (hasStatusColumn) {
            return connection.query(
                `
                    UPDATE products
                    SET status = CASE WHEN quantity <= 0 THEN "sold_out" ELSE "in_stock" END
                    WHERE status IS NULL
                       OR status NOT IN ("in_stock","sold_out")
                       OR (quantity <= 0 AND status <> "sold_out")
                       OR (quantity > 0 AND status <> "in_stock")
                `,
                (updateErr) => {
                    if (updateErr) {
                        console.error('Unable to hydrate product status values:', updateErr);
                    } else {
                        console.log('Product status column ready');
                    }
                    done();
                }
            );
        }

        const alterProductSQL = `
            ALTER TABLE products
            ADD COLUMN status ENUM('in_stock', 'sold_out') NOT NULL DEFAULT 'in_stock'
        `;

        connection.query(alterProductSQL, (error) => {
            if (error) {
                console.error('Unable to ensure product status column exists:', error);
            } else {
                console.log('Product status column added');
            }
            if (!error) {
                done();
            }
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
            } else {
                console.log(`Seeded showcase products: ${missingProducts.map((item) => item.productName).join(', ')}`);
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
            PRIMARY_ADMIN_PROFILE.username,
            PRIMARY_ADMIN_EMAIL,
            PRIMARY_ADMIN_PASSWORD,
            PRIMARY_ADMIN_PROFILE.address,
            PRIMARY_ADMIN_PROFILE.contact,
            PRIMARY_ADMIN_EMAIL
        ],
        (error) => {
            if (error) {
                console.error('Unable to seed the primary admin account:', error);
            } else {
                console.log('Primary admin account verified or created.');
            }
        }
    );
};

connection.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
        return;
    }
    console.log('Connected to MySQL database');
    ensureReviewInfrastructure();
    ensureCartInfrastructure();
    ensureOrderInfrastructure();
    ensureProductStatusColumn(() => {
        ensureShowcaseProducts();
    });
    ensurePrimaryAdmin();
});

const homeController = createHomeController({
    connection,
    heroCopy,
    decorateProduct
});

const authController = createAuthController({
    connection,
    primaryAdminEmail: PRIMARY_ADMIN_EMAIL
});

const shoppingController = createShoppingController({
    connection,
    decorateProduct
});

const cartController = createCartController({ connection });

const productController = createProductController({
    connection,
    decorateProduct,
    models
});

const reviewController = createReviewController({ connection, models });

const adminController = createAdminController({
    connection,
    primaryAdminEmail: PRIMARY_ADMIN_EMAIL
});

// Set up view engine
app.set('view engine', 'ejs');
//  enable static files
app.use(express.static('public'));
// enable form processing
app.use(express.urlencoded({
    extended: false
}));

//TO DO: Insert code for Session Middleware below 
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    // Session expires after 1 week of inactivity
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } 
}));

app.use(flash());

// Middleware to check if user is logged in
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    } else {
        req.flash('error', 'Please log in to view this resource');
        res.redirect('/login');
    }
};

// Middleware to check if user is admin
const checkAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    req.flash('error', 'Access denied');
    res.redirect('/shopping');
};

const checkPrimaryAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.email === PRIMARY_ADMIN_EMAIL) {
        return next();
    }
    req.flash('error', 'Only the primary admin can perform that action.');
    res.redirect('/inventory');
};

const requireShopper = (req, res, next) => {
    const sessionUser = req.session.user;
    const referer = req.get('referer');

    if (!sessionUser) {
        req.flash('error', 'Please log in or register (username, email, password, address, contact number) to add items to your cart.');
        return res.redirect('/login');
    }

    if (sessionUser.role !== 'user') {
        req.flash('error', 'Switch to a shopper account to perform this action.');
        return res.redirect(referer || '/shopping');
    }

    return next();
};

// Middleware for form validation
const validateRegistration = (req, res, next) => {
    const { username, email, password, address, contact } = req.body;

    if (!username || !email || !password || !address || !contact) {
        return res.status(400).send('All fields are required.');
    }
    
    if (password.length < 6) {
        req.flash('error', 'Password should be at least 6 or more characters long');
        const formData = { ...req.body };
        delete formData.password;
        req.flash('formData', formData);
        return res.redirect('/register');
    }
    next();
};

// Define routes
app.get('/', homeController.renderHomePage);

app.get('/inventory', checkAuthenticated, checkAdmin, productController.renderInventory);

app.get('/register', authController.renderRegister);
app.post('/register', validateRegistration, authController.handleRegistration);

app.get('/login', authController.renderLogin);
app.post('/login', authController.handleLogin);
app.get('/profile', checkAuthenticated, authController.renderProfile);
app.post('/profile', checkAuthenticated, authController.updateProfile);

app.get('/shopping', shoppingController.renderShopping);
app.post('/add-to-cart/:id', requireShopper, cartController.addToCart);

app.get('/cart', requireShopper, cartController.renderCart);
app.post('/cart/update/:id', requireShopper, cartController.updateCartItem);
app.post('/cart/delete/:id', requireShopper, cartController.deleteCartItem);
app.post('/cart/clear', requireShopper, cartController.clearCart);
app.get('/checkout', requireShopper, cartController.renderCheckout);
app.post('/checkout', requireShopper, cartController.placeOrder);
app.get('/checkout/success/:orderId', requireShopper, cartController.renderOrderSuccess);
app.get('/orders', requireShopper, cartController.renderOrderHistory);
app.get('/orders/:id/invoice', requireShopper, cartController.renderInvoice);
app.get('/logout', authController.logout);

app.get('/product/:id', productController.renderProductDetails);
app.post('/product/:id/reviews', requireShopper, reviewController.submitProductReview);
app.post('/admin/reviews/:id/delete', checkAuthenticated, checkAdmin, reviewController.deleteReview);
app.post('/admin/reviews/:id/reply', checkAuthenticated, checkAdmin, reviewController.replyToReview);

app.get('/addProduct', checkAuthenticated, checkAdmin, productController.renderAddProductForm);
app.post('/addProduct', checkAuthenticated, checkAdmin, upload.single('image'), productController.createProduct);

app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, productController.renderUpdateProductForm);
app.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), productController.updateProduct);

app.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, productController.deleteProduct);

app.get('/admin/users', checkAuthenticated, checkAdmin, adminController.renderUserManagement);
app.post('/admin/users', checkAuthenticated, checkAdmin, adminController.createUser);
app.post('/admin/users/:id/promote', checkAuthenticated, checkAdmin, adminController.promoteUser);
app.post('/admin/users/:id/demote', checkAuthenticated, checkAdmin, adminController.demoteUser);
app.post('/admin/users/:id/delete', checkAuthenticated, checkAdmin, adminController.deleteUser);
app.get('/admin/orders', checkAuthenticated, checkAdmin, adminController.renderAllOrders);
app.post('/admin/orders/:id/status', checkAuthenticated, checkAdmin, adminController.updateOrderStatus);
app.get('/admin/orders/:id/invoice', checkAuthenticated, checkAdmin, adminController.renderInvoice);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port http://localhost:${PORT}`));
