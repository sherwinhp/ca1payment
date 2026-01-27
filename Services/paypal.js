require('dotenv').config();
const fetch = global.fetch || require('node-fetch');

const PAYPAL_CLIENT = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_API = process.env.PAYPAL_API;

async function getAccessToken() {
  if (!PAYPAL_CLIENT || !PAYPAL_SECRET || !PAYPAL_API) {
    throw new Error('PayPal is not configured. Check PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, and PAYPAL_API.');
  }

  const response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(PAYPAL_CLIENT + ':' + PAYPAL_SECRET).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error_description || data?.error || 'Unable to get PayPal access token.');
  }
  return data.access_token;
}

async function createOrder(amount) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: 'SGD',
          value: String(amount)
        }
      }]
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || data?.name || 'Unable to create PayPal order.');
  }
  return data;
}

async function captureOrder(orderId) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    }
  });
  const data = await response.json();
  console.log('PayPal captureOrder response:', data);
  if (!response.ok) {
    throw new Error(data?.message || data?.name || 'Unable to capture PayPal order.');
  }
  return data;
}

async function refundCapture(captureId, amount) {
  const accessToken = await getAccessToken();
  const body = amount
    ? {
        amount: {
          currency_code: 'SGD',
          value: String(amount)
        }
      }
    : undefined;
  const response = await fetch(`${PAYPAL_API}/v2/payments/captures/${captureId}/refund`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  console.log('PayPal refundCapture response:', data);
  if (!response.ok) {
    throw new Error(data?.message || data?.name || 'Unable to refund PayPal capture.');
  }
  return data;
}

module.exports = { createOrder, captureOrder, refundCapture };
