const paypalService = require('../Services/paypal');
const netsService = require('../Services/nets');

const createPaymentController = ({ connection, getCartForCheckout, createOrderFromCart }) => {
    const loadCartSummary = (userId) =>
        getCartForCheckout(userId).then((items) => {
            if (!items.length) {
                throw new Error('Your cart is empty.');
            }
            const total = items.reduce((acc, item) => acc + Number(item.price) * Number(item.quantity || 0), 0);
            return { items, total: Number(total.toFixed(2)) };
        });

    const createPaypalOrder = async (req, res) => {
        try {
            const userId = req.session.user.id;
            const { total } = await loadCartSummary(userId);
            const order = await paypalService.createOrder(total);

            if (!order || !order.id) {
                return res.status(500).json({ error: 'Unable to start PayPal checkout.' });
            }

            res.json({ id: order.id });
        } catch (error) {
            console.error('Unable to start PayPal checkout:', error);
            res.status(500).json({ error: 'Unable to start PayPal checkout.' });
        }
    };

    const capturePaypalOrder = async (req, res) => {
        const { orderId } = req.body || {};
        if (!orderId) {
            return res.status(400).json({ error: 'Missing PayPal order id.' });
        }

        try {
            const capture = await paypalService.captureOrder(orderId);
            const status = capture?.status;

            if (status !== 'COMPLETED') {
                return res.status(400).json({ error: 'PayPal payment was not completed.' });
            }

            const dbOrderId = await createOrderFromCart(req.session.user.id, 'paypal');
            res.json({ redirectUrl: `/orders/${dbOrderId}/invoice` });
        } catch (error) {
            console.error('Unable to capture PayPal order:', error);
            res.status(500).json({ error: 'Unable to capture PayPal payment.' });
        }
    };

    const startNetsPayment = async (req, res) => {
        try {
            const userId = req.session.user.id;
            const { total } = await loadCartSummary(userId);

            req.body = { ...req.body, cartTotal: total.toFixed(2) };
            return netsService.generateQrCode(req, res);
        } catch (error) {
            console.error('Unable to start NETS payment:', error);
            req.flash('error', 'Unable to start NETS payment right now.');
            return res.redirect('/checkout');
        }
    };

    const finishNetsPayment = (req, res) => {
        createOrderFromCart(req.session.user.id, 'nets')
            .then((orderId) => res.redirect(`/orders/${orderId}/invoice`))
            .catch((error) => {
                console.error('Unable to finalize NETS order:', error);
                req.flash('error', error.message || 'Unable to finalize payment.');
                res.redirect('/checkout');
            });
    };

    return {
        createPaypalOrder,
        capturePaypalOrder,
        startNetsPayment,
        finishNetsPayment
    };
};

module.exports = createPaymentController;
