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
        const { email, password } = req.body;

        if (!email || !password) {
            req.flash('error', 'All fields are required.');
            return res.redirect('/login');
        }

        const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
        connection.query(sql, [email, password], (err, results) => {
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
                req.flash('error', 'Invalid email or password.');
                res.redirect('/login');
            }
        });
    };

    const logout = (req, res) => {
        req.session.destroy();
        res.redirect('/');
    };

    const renderProfile = (req, res) => {
        const currentUserId = req.session.user.id;
        const fetchSQL = 'SELECT id, username, email, address, contact, role FROM users WHERE id = ?';

        connection.query(fetchSQL, [currentUserId], (error, results = []) => {
            if (error || !results.length) {
                console.error('Unable to load profile:', error);
                req.flash('error', 'We could not load your profile right now.');
            }

            const resolvedUser = markPrimaryAdmin(results[0] || req.session.user);
            const formData = req.flash('formData')[0] || resolvedUser;
            res.render('profile', {
                user: resolvedUser,
                formData,
                messages: {
                    errors: req.flash('error'),
                    success: req.flash('success')
                }
            });
        });
    };

    const updateProfile = (req, res) => {
        const { username, email, address, contact, password, oldPassword } = req.body;
        const userId = req.session.user.id;
        const errors = [];

        if (!username || !email || !address || !contact) {
            errors.push('All profile fields are required.');
        }

        if (password && password.length > 0 && password.length < 6) {
            errors.push('If provided, your new password must be at least 6 characters long.');
        }

        if (errors.length) {
            errors.forEach((message) => req.flash('error', message));
            req.flash('formData', { username, email, address, contact });
            return res.redirect('/profile');
        }

        const emailCheckSQL = 'SELECT id FROM users WHERE email = ? AND id <> ?';
        connection.query(emailCheckSQL, [email, userId], (emailErr, existingUsers = []) => {
            if (emailErr) {
                console.error('Unable to validate email uniqueness:', emailErr);
                req.flash('error', 'Unable to update profile right now. Please try again later.');
                req.flash('formData', { username, email, address, contact });
                return res.redirect('/profile');
            }

            if (existingUsers.length) {
                req.flash('error', 'That email is already in use. Please choose another.');
                req.flash('formData', { username, email, address, contact });
                return res.redirect('/profile');
            }

            const updateFields = ['username = ?', 'email = ?', 'address = ?', 'contact = ?'];
            const params = [username, email, address, contact];

            const finalizeUpdate = () => {
                const updateSQL = `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`;
                params.push(userId);
                connection.query(updateSQL, params, (updateErr) => {
                    if (updateErr) {
                        console.error('Unable to update profile:', updateErr);
                        req.flash('error', 'We could not save your changes. Please try again.');
                        req.flash('formData', { username, email, address, contact });
                        return res.redirect('/profile');
                    }

                    const updatedUser = markPrimaryAdmin({
                        ...req.session.user,
                        username,
                        email,
                        address,
                        contact
                    });

                    req.session.user = updatedUser;
                    req.flash('success', 'Profile updated successfully.');
                    res.redirect('/profile');
                });
            };

            if (password && password.length >= 6) {
                if (!oldPassword) {
                    req.flash('error', 'Please provide your current password to change it.');
                    req.flash('formData', { username, email, address, contact });
                    return res.redirect('/profile');
                }

                const passwordCheckSQL = 'SELECT password FROM users WHERE id = ?';
                connection.query(passwordCheckSQL, [userId], (pwErr, pwRows = []) => {
                    if (pwErr || !pwRows.length) {
                        console.error('Unable to validate current password:', pwErr);
                        req.flash('error', 'Unable to update profile right now.');
                        req.flash('formData', { username, email, address, contact });
                        return res.redirect('/profile');
                    }

                    const isMatchSQL = 'SELECT 1 FROM users WHERE id = ? AND password = SHA1(?)';
                    connection.query(isMatchSQL, [userId, oldPassword], (matchErr, matches = []) => {
                        if (matchErr || !matches.length) {
                            req.flash('error', 'Current password is incorrect.');
                            req.flash('formData', { username, email, address, contact });
                            return res.redirect('/profile');
                        }

                        updateFields.push('password = SHA1(?)');
                        params.push(password);
                        finalizeUpdate();
                    });
                });
            } else {
                finalizeUpdate();
            }
        });
    };

    return {
        renderRegister,
        handleRegistration,
        renderLogin,
        handleLogin,
        logout,
        renderProfile,
        updateProfile
    };
};

module.exports = createAuthController;
