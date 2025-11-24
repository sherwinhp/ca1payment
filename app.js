const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const app = express();

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

    return {
        ...productRow,
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

const ensureReviewInfrastructure = () => {
    const createReviewTableSQL = `
        CREATE TABLE IF NOT EXISTS product_reviews (
            id INT AUTO_INCREMENT PRIMARY KEY,
            product_id INT NOT NULL,
            user_id INT NOT NULL,
            rating TINYINT NOT NULL,
            review TEXT,
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
        }
    });
};

connection.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
        return;
    }
    console.log('Connected to MySQL database');
    ensureReviewInfrastructure();
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
    if (req.session.user.role === 'admin') {
        return next();
    } else {
        req.flash('error', 'Access denied');
        res.redirect('/shopping');
    }
};

// Middleware for form validation
const validateRegistration = (req, res, next) => {
    const { username, email, password, address, contact, role } = req.body;

    if (!username || !email || !password || !address || !contact || !role) {
        return res.status(400).send('All fields are required.');
    }
    
    if (password.length < 6) {
        req.flash('error', 'Password should be at least 6 or more characters long');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }
    next();
};

// Define routes
app.get('/', (req, res) => {
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

        const featuredProducts = results.map(decorateProduct);
        res.render('index', {
            user: req.session.user,
            featuredProducts,
            heroCopy,
            alerts: []
        });
    });
});

app.get('/inventory', checkAuthenticated, checkAdmin, (req, res) => {
    // Fetch data from MySQL
    connection.query('SELECT * FROM products', (error, results) => {
      if (error) throw error;
      res.render('inventory', { products: results, user: req.session.user });
    });
});

app.get('/register', (req, res) => {
    res.render('register', { messages: req.flash('error'), formData: req.flash('formData')[0] });
});

app.post('/register', validateRegistration, (req, res) => {

    const { username, email, password, address, contact, role } = req.body;

    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
    connection.query(sql, [username, email, password, address, contact, role], (err, result) => {
        if (err) {
            throw err;
        }
        console.log(result);
        req.flash('success', 'Registration successful! Please log in.');
        res.redirect('/login');
    });
});

app.get('/login', (req, res) => {
    res.render('login', { messages: req.flash('success'), errors: req.flash('error') });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;

    // Validate email and password
    if (!email || !password) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/login');
    }

    const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
    connection.query(sql, [email, password], (err, results) => {
        if (err) {
            throw err;
        }

        if (results.length > 0) {
            // Successful login
            req.session.user = results[0]; 
            req.flash('success', 'Login successful!');
            if(req.session.user.role == 'user')
                res.redirect('/shopping');
            else
                res.redirect('/inventory');
        } else {
            // Invalid credentials
            req.flash('error', 'Invalid email or password.');
            res.redirect('/login');
        }
    });
});

app.get('/shopping', checkAuthenticated, (req, res) => {
    // Fetch data from MySQL
    connection.query('SELECT * FROM products', (error, results) => {
        if (error) throw error;
        res.render('shopping', { user: req.session.user, products: results });
      });
});

app.post('/add-to-cart/:id', checkAuthenticated, (req, res) => {
    const productId = parseInt(req.params.id);
    const quantity = parseInt(req.body.quantity) || 1;

    connection.query('SELECT * FROM products WHERE id = ?', [productId], (error, results) => {
        if (error) throw error;

        if (results.length > 0) {
            const product = results[0];

            // Initialize cart in session if not exists
            if (!req.session.cart) {
                req.session.cart = [];
            }

            // Check if product already in cart
            const existingItem = req.session.cart.find(item => item.productId === productId);
            if (existingItem) {
                existingItem.quantity += quantity;
            } else {
                req.session.cart.push({
                    id: product.productId,
                    productName: product.productName,
                    price: product.price,
                    quantity: quantity,
                    image: product.image
                });
            }

            res.redirect('/cart');
        } else {
            res.status(404).send("Product not found");
        }
    });
});

app.get('/cart', checkAuthenticated, (req, res) => {
    const cart = req.session.cart || [];
    res.render('cart', { cart, user: req.session.user });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/product/:id', checkAuthenticated, (req, res) => {
    const productId = parseInt(req.params.id, 10);
    const singleProductSQL = `
        SELECT p.*, COALESCE(AVG(r.rating), 0) AS averageRating, COUNT(r.id) AS reviewCount
        FROM products p
        LEFT JOIN product_reviews r ON r.product_id = p.id
        WHERE p.id = ?
        GROUP BY p.id
    `;

    connection.query(singleProductSQL, [productId], (error, productResults) => {
        if (error) {
            console.error('Unable to fetch product details:', error);
            return res.status(500).send('Unable to load product right now.');
        }

        if (!productResults.length) {
            return res.status(404).send('Product not found');
        }

        const product = decorateProduct(productResults[0]);
        const reviewsSQL = `
            SELECT r.id, r.rating, r.review, r.created_at, r.updated_at, r.user_id, u.username, u.role
            FROM product_reviews r
            INNER JOIN users u ON u.id = r.user_id
            WHERE r.product_id = ?
            ORDER BY r.updated_at DESC
        `;

        connection.query(reviewsSQL, [productId], (reviewErr, reviewResults) => {
            if (reviewErr) {
                console.error('Unable to fetch reviews:', reviewErr);
                return res.status(500).send('Unable to load product reviews right now.');
            }

            const ratingBuckets = [5, 4, 3, 2, 1].map((stars) => ({
                stars,
                count: reviewResults.filter((review) => review.rating === stars).length
            }));

            const userReview = reviewResults.find((review) => review.user_id === req.session.user.id);

            res.render('product', {
                product,
                user: req.session.user,
                reviews: reviewResults,
                reviewSummary: {
                    total: reviewResults.length,
                    buckets: ratingBuckets
                },
                userReview,
                canReview: req.session.user.role === 'user',
                messages: {
                    errors: req.flash('error'),
                    success: req.flash('success')
                }
            });
        });
    });
});

app.post('/product/:id/reviews', checkAuthenticated, (req, res) => {
    const productId = parseInt(req.params.id, 10);
    const { rating, reviewText } = req.body;

    if (req.session.user.role !== 'user') {
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

    connection.query(upsertSQL, [productId, req.session.user.id, numericRating, sanitizedReview], (error) => {
        if (error) {
            console.error('Unable to save review:', error);
            req.flash('error', 'We could not save your review right now. Please try again later.');
        } else {
            req.flash('success', 'Thanks for sharing your thoughts with the community!');
        }

        res.redirect(`/product/${productId}#reviews`);
    });
});

app.get('/addProduct', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('addProduct', {user: req.session.user } ); 
});

app.post('/addProduct', upload.single('image'),  (req, res) => {
    // Extract product data from the request body
    const { name, quantity, price} = req.body;
    let image;
    if (req.file) {
        image = req.file.filename; // Save only the filename
    } else {
        image = null;
    }

    const sql = 'INSERT INTO products (productName, quantity, price, image) VALUES (?, ?, ?, ?)';
    // Insert the new product into the database
    connection.query(sql , [name, quantity, price, image], (error, results) => {
        if (error) {
            // Handle any error that occurs during the database operation
            console.error("Error adding product:", error);
            res.status(500).send('Error adding product');
        } else {
            // Send a success response
            res.redirect('/inventory');
        }
    });
});

app.get('/updateProduct/:id',checkAuthenticated, checkAdmin, (req,res) => {
    const productId = req.params.id;
    const sql = 'SELECT * FROM products WHERE id = ?';

    // Fetch data from MySQL based on the product ID
    connection.query(sql , [productId], (error, results) => {
        if (error) throw error;

        // Check if any product with the given ID was found
        if (results.length > 0) {
            // Render HTML page with the product data
            res.render('updateProduct', { product: results[0] });
        } else {
            // If no product with the given ID was found, render a 404 page or handle it accordingly
            res.status(404).send('Product not found');
        }
    });
});

app.post('/updateProduct/:id', upload.single('image'), (req, res) => {
    const productId = req.params.id;
    // Extract product data from the request body
    const { name, quantity, price } = req.body;
    let image  = req.body.currentImage; //retrieve current image filename
    if (req.file) { //if new image is uploaded
        image = req.file.filename; // set image to be new image filename
    } 

    const sql = 'UPDATE products SET productName = ? , quantity = ?, price = ?, image =? WHERE id = ?';
    // Insert the new product into the database
    connection.query(sql, [name, quantity, price, image, productId], (error, results) => {
        if (error) {
            // Handle any error that occurs during the database operation
            console.error("Error updating product:", error);
            res.status(500).send('Error updating product');
        } else {
            // Send a success response
            res.redirect('/inventory');
        }
    });
});

app.get('/deleteProduct/:id', (req, res) => {
    const productId = req.params.id;

    connection.query('DELETE FROM products WHERE id = ?', [productId], (error, results) => {
        if (error) {
            // Handle any error that occurs during the database operation
            console.error("Error deleting product:", error);
            res.status(500).send('Error deleting product');
        } else {
            // Send a success response
            res.redirect('/inventory');
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
