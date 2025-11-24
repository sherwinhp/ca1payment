const createAdminController = ({ connection, primaryAdminEmail }) => {
    const renderUserManagement = (req, res) => {
        const listUsersSQL = 'SELECT id, username, email, role FROM users ORDER BY role DESC, username ASC';

        connection.query(listUsersSQL, (error, results = []) => {
            if (error) {
                console.error('Unable to load users for management:', error);
                return res.status(500).send('Unable to load users right now.');
            }

            res.render('manageUsers', {
                user: req.session.user,
                users: results,
                primaryAdminEmail,
                formData: req.flash('userFormData')[0],
                messages: {
                    success: req.flash('success'),
                    error: req.flash('error')
                }
            });
        });
    };

    const promoteUser = (req, res) => {
        const targetUserId = parseInt(req.params.id, 10);

        if (!Number.isInteger(targetUserId)) {
            req.flash('error', 'Invalid user selected.');
            return res.redirect('/admin/users');
        }

        const promoteSQL = `
            UPDATE users
            SET role = 'admin'
            WHERE id = ? AND email <> ? AND role <> 'admin'
        `;

        connection.query(promoteSQL, [targetUserId, primaryAdminEmail], (error, result) => {
            if (error) {
                console.error('Unable to promote user:', error);
                req.flash('error', 'Unable to promote user right now.');
            } else if (!result.affectedRows) {
                req.flash('error', 'User not found or already an admin.');
            } else {
                req.flash('success', 'User has been promoted to admin.');
            }

            res.redirect('/admin/users');
        });
    };

    const createUser = (req, res) => {
        const { username, email, password, address, contact, role } = req.body;
        const normalizedRole = role === 'admin' ? 'admin' : 'user';
        const errors = [];

        if (!username || !email || !password || !address || !contact) {
            errors.push('All fields are required to create a user.');
        }

        if (password && password.length < 6) {
            errors.push('Password must be at least 6 characters long.');
        }

        if (errors.length) {
            errors.forEach((message) => req.flash('error', message));
            req.flash('userFormData', { username, email, address, contact, role: normalizedRole });
            return res.redirect('/admin/users');
        }

        const emailCheckSQL = 'SELECT id FROM users WHERE email = ?';
        connection.query(emailCheckSQL, [email], (checkErr, existing = []) => {
            if (checkErr) {
                console.error('Unable to check email before creating user:', checkErr);
                req.flash('error', 'Unable to create user right now.');
                req.flash('userFormData', { username, email, address, contact, role: normalizedRole });
                return res.redirect('/admin/users');
            }

            if (existing.length) {
                req.flash('error', 'This email is already registered.');
                req.flash('userFormData', { username, email, address, contact, role: normalizedRole });
                return res.redirect('/admin/users');
            }

            const insertSQL = `
                INSERT INTO users (username, email, password, address, contact, role)
                VALUES (?, ?, SHA1(?), ?, ?, ?)
            `;

            connection.query(insertSQL, [username, email, password, address, contact, normalizedRole], (insertErr) => {
                if (insertErr) {
                    console.error('Unable to create user:', insertErr);
                    req.flash('error', 'Unable to create user right now.');
                    req.flash('userFormData', { username, email, address, contact, role: normalizedRole });
                } else {
                    req.flash('success', `Created ${normalizedRole} account for ${username}.`);
                }

                res.redirect('/admin/users');
            });
        });
    };

    const deleteUser = (req, res) => {
        const targetUserId = parseInt(req.params.id, 10);

        if (!Number.isInteger(targetUserId)) {
            req.flash('error', 'Invalid user selected.');
            return res.redirect('/admin/users');
        }

        if (targetUserId === req.session.user.id) {
            req.flash('error', 'You cannot delete your own account from the dashboard.');
            return res.redirect('/admin/users');
        }

        const deleteSQL = 'DELETE FROM users WHERE id = ? AND email <> ?';
        connection.query(deleteSQL, [targetUserId, primaryAdminEmail], (error, result) => {
            if (error) {
                console.error('Unable to delete user:', error);
                req.flash('error', 'Unable to delete user right now.');
            } else if (!result.affectedRows) {
                req.flash('error', 'User not found or cannot be deleted.');
            } else {
                req.flash('success', 'User account deleted.');
            }

            res.redirect('/admin/users');
        });
    };

    return {
        renderUserManagement,
        promoteUser,
        createUser,
        deleteUser
    };
};

module.exports = createAdminController;
