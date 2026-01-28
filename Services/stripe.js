require('dotenv').config();
const Stripe = require('stripe');

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET) {
    console.warn('Stripe secret key is not configured. Set STRIPE_SECRET_KEY in .env.');
}

const stripe = STRIPE_SECRET ? new Stripe(STRIPE_SECRET) : null;

const toStripeAmount = (amount) => {
    const value = Number(amount);
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 100);
};

const createPaymentIntent = async ({ amount, currency = 'sgd', paymentMethodId, description, metadata }) => {
    if (!stripe) {
        throw new Error('Stripe is not configured. Check STRIPE_SECRET_KEY.');
    }
    if (!paymentMethodId) {
        throw new Error('Missing Stripe payment method.');
    }

    const intent = await stripe.paymentIntents.create({
        amount: toStripeAmount(amount),
        currency,
        payment_method: paymentMethodId,
        payment_method_types: ['card'],
        confirm: true,
        description,
        metadata,
        expand: ['charges.data.outcome', 'charges.data.payment_method_details']
    });
    return intent;
};

const refundCharge = async ({ chargeId, amount }) => {
    if (!stripe) {
        throw new Error('Stripe is not configured. Check STRIPE_SECRET_KEY.');
    }
    if (!chargeId) {
        throw new Error('Missing Stripe charge id.');
    }

    const isPaymentIntent = String(chargeId).startsWith('pi_');
    const refundParams = isPaymentIntent ? { payment_intent: chargeId } : { charge: chargeId };
    if (amount) {
        refundParams.amount = toStripeAmount(amount);
    }

    const refund = await stripe.refunds.create({
        ...refundParams
    });
    return refund;
};

const constructWebhookEvent = ({ payload, signature, secret }) => {
    if (!stripe) {
        throw new Error('Stripe is not configured. Check STRIPE_SECRET_KEY.');
    }
    if (!secret) {
        throw new Error('Stripe webhook secret is not configured.');
    }
    return stripe.webhooks.constructEvent(payload, signature, secret);
};

module.exports = { createPaymentIntent, refundCharge, constructWebhookEvent };
