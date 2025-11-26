const session = require('express-session');

const createMiddleware = ({ primaryAdminEmail }) => {
    const sessionMiddleware = session({
        secret: 'secret',
        resave: false,
        saveUninitialized: true,
        // Session expires after 1 week of inactivity
        cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
    });

    const checkAuthenticated = (req, res, next) => {
        if (req.session.user) {
            return next();
        }
        req.flash('error', 'Please log in to view this resource');
        res.redirect('/login');
    };

    const checkAdmin = (req, res, next) => {
        if (req.session.user && req.session.user.role === 'admin') {
            return next();
        }
        req.flash('error', 'Access denied');
        res.redirect('/shopping');
    };

    const checkPrimaryAdmin = (req, res, next) => {
        if (req.session.user && req.session.user.email === primaryAdminEmail) {
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

    const validateRegistration = (req, res, next) => {
        const { username, email, password, address, contact } = req.body;
        const hasNumber = /\d/;
        const hasSpecial = /[!@#$%^&*(),.?":{}|<>_\-\[\]\\\/+~=]/;

        if (!username || !email || !password || !address || !contact) {
            return res.status(400).send('All fields are required.');
        }
        
        if (password.length < 6 || !hasNumber.test(password) || !hasSpecial.test(password)) {
            req.flash('error', 'Password must be at least 6 characters and include a number and a special character.');
            const formData = { ...req.body };
            delete formData.password;
            req.flash('formData', formData);
            return res.redirect('/register');
        }
        next();
    };

    return {
        sessionMiddleware,
        checkAuthenticated,
        checkAdmin,
        checkPrimaryAdmin,
        requireShopper,
        validateRegistration
    };
};

module.exports = createMiddleware;
