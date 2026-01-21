const express = require('express');
const flash = require('connect-flash');
const multer = require('multer');
const createHomeController = require('./controllers/homeController');
const createAuthController = require('./controllers/authController');
const createShoppingController = require('./controllers/shoppingController');
const createCartController = require('./controllers/cartController');
const createPaymentController = require('./controllers/paymentController');
const createProductController = require('./controllers/productController');
const createReviewController = require('./controllers/reviewController');
const createAdminController = require('./controllers/adminController');
const createModels = require('./models/Supermarket');
const createMiddleware = require('./middleware');
const createUserController = require('./controllers/userController');
const { productShowcaseCopy, heroCopy, decorateProduct } = require('./productCopy');
const { connection, initializeDatabase } = require('./db');
const app = express();

const PRIMARY_ADMIN_EMAIL = '24046565@myrp.edu.sg';
const PRIMARY_ADMIN_PASSWORD = '1234567';
const PRIMARY_ADMIN_PROFILE = {
    username: 'Supermarket Director',
    address: 'Republic Polytechnic',
    contact: '00000000'
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

const models = createModels(connection);

connection.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
        return;
    }
    console.log('Connected to MySQL database');
    initializeDatabase({
        primaryAdminEmail: PRIMARY_ADMIN_EMAIL,
        primaryAdminPassword: PRIMARY_ADMIN_PASSWORD,
        primaryAdminProfile: PRIMARY_ADMIN_PROFILE
    });
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

const userController = createUserController({
    connection,
    primaryAdminEmail: PRIMARY_ADMIN_EMAIL
});

const shoppingController = createShoppingController({
    connection,
    decorateProduct
});

const cartController = createCartController({ connection });
const paymentController = createPaymentController({
    connection,
    getCartForCheckout: cartController.getCartForCheckout,
    createOrderFromCart: cartController.createOrderFromCart
});

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

const {
    sessionMiddleware,
    checkAuthenticated,
    checkAdmin,
    checkPrimaryAdmin,
    requireShopper,
    validateRegistration
} = createMiddleware({ primaryAdminEmail: PRIMARY_ADMIN_EMAIL });

// Set up view engine
app.set('view engine', 'ejs');
//  enable static files
app.use(express.static('public'));
// enable form processing
app.use(express.urlencoded({
    extended: false
}));
// enable JSON payloads (for PayPal SDK callbacks)
app.use(express.json());

// Session middleware
app.use(sessionMiddleware);

app.use(flash());

// Define routes
app.get('/', homeController.renderHomePage);

app.get('/inventory', checkAuthenticated, checkAdmin, productController.renderInventory);

app.get('/register', authController.renderRegister);
app.post('/register', validateRegistration, authController.handleRegistration);

app.get('/login', authController.renderLogin);
app.post('/login', authController.handleLogin);
app.get('/profile', checkAuthenticated, userController.renderProfile);
app.post('/profile', checkAuthenticated, userController.updateProfile);

app.get('/shopping', shoppingController.renderShopping);
app.post('/add-to-cart/:id', requireShopper, cartController.addToCart);

app.get('/cart', requireShopper, cartController.renderCart);
app.post('/cart/update/:id', requireShopper, cartController.updateCartItem);
app.post('/cart/delete/:id', requireShopper, cartController.deleteCartItem);
app.post('/cart/clear', requireShopper, cartController.clearCart);
app.get('/checkout', requireShopper, cartController.renderCheckout);
app.post('/checkout', requireShopper, cartController.placeOrder);
app.post('/payments/paypal/create', requireShopper, paymentController.createPaypalOrder);
app.post('/payments/paypal/capture', requireShopper, paymentController.capturePaypalOrder);
app.post('/payments/nets', requireShopper, paymentController.startNetsPayment);
app.get('/payments/nets/status/:txnRetrievalRef', requireShopper, paymentController.streamNetsStatus);
app.get('/payments/nets/complete', requireShopper, paymentController.finishNetsPayment);
app.post('/payments/nets/complete', requireShopper, paymentController.finishNetsPayment);
app.get('/payments/nets/fail', requireShopper, paymentController.renderNetsFailure);
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
