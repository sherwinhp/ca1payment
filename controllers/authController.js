const createAuthController = ({ connection, primaryAdminEmail }) => {
    const markPrimaryAdmin = (userRecord) => {
        if (userRecord) {
            userRecord.isPrimaryAdmin = userRecord.email === primaryAdminEmail;
        }
        return userRecord;
    };

    const renderRegister = (req, res) => {
        res.render('register', {
            messages: req.flash('error'),
            formData: req.flash('formData')[0],
            user: req.session.user
        });
    };

    const handleRegistration = (req, res) => {
        const { username, email, password, address, contact } = req.body;
        const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
        const params = [username, email, password, address, contact, 'user'];

        connection.query(sql, params, (err) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    req.flash('error', 'That email is already registered. Please log in instead.');
                    req.flash('formData', { username, email, address, contact });
                    return res.redirect('/register');
                }

                console.error('Unable to register user:', err);
                req.flash('error', 'Unable to register right now. Please try again in a moment.');
                req.flash('formData', { username, email, address, contact });
                return res.redirect('/register');
            }

            req.flash('success', 'Registration successful! Please log in.');
            res.redirect('/login');
        });
    };

    const renderLogin = (req, res) => {
        res.render('login', {
            messages: req.flash('success'),
            errors: req.flash('error'),
            user: req.session.user
        });
    };

    const handleLogin = (req, res) => {
        const { identifier, password } = req.body;

        if (!identifier || !password) {
            req.flash('error', 'Email/username and password are required.');
            return res.redirect('/login');
        }

        const sql = 'SELECT * FROM users WHERE (email = ? OR username = ?) AND password = SHA1(?)';
        connection.query(sql, [identifier, identifier, password], (err, results) => {
            if (err) throw err;

            if (results.length > 0) {
                const authenticatedUser = markPrimaryAdmin(results[0]);
                req.session.user = authenticatedUser;
                req.flash('success', 'Login successful!');

                if (authenticatedUser.role === 'user') {
                    res.redirect('/shopping');
                } else {
                    res.redirect('/inventory');
                }
            } else {
                req.flash('error', 'Invalid email/username or password.');
                res.redirect('/login');
            }
        });
    };

    const logout = (req, res) => {
        req.session.destroy();
        res.redirect('/');
    };

    return {
        renderRegister,
        handleRegistration,
        renderLogin,
        handleLogin,
        logout
    };
};

module.exports = createAuthController;
