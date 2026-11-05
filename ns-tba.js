// ns-tba.js
require('dotenv').config();
const OAuth  = require('oauth-1.0a');
const crypto = require('crypto');
const axios  = require('axios');

const NS_ACCOUNT      = process.env.NS_ACCOUNT;
const CONSUMER_KEY    = process.env.NS_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.NS_CONSUMER_SECRET;
const TOKEN_KEY       = process.env.NS_TOKEN_KEY;
const TOKEN_SECRET    = process.env.NS_TOKEN_SECRET;

const oauth = OAuth({
  consumer: { key: CONSUMER_KEY, secret: CONSUMER_SECRET },
  signature_method: 'HMAC-SHA256',
  hash_function: (base, key) =>
    crypto.createHmac('sha256', key).update(base).digest('base64'),
});

async function nsRequest(method, url, body = null, extraHeaders = {}) {
  const requestData = { url, method };
  const token       = { key: TOKEN_KEY, secret: TOKEN_SECRET };
  const authHeader  = oauth.toHeader(oauth.authorize(requestData, token));

  authHeader.Authorization += `, realm="${NS_ACCOUNT}"`;

  try {
    const res = await axios({
      method,
      url,
      data:         body,
      maxRedirects: 0,
      headers: {
        ...authHeader,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
    });
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    const detail = JSON.stringify(err.response?.data ?? err.message);
    throw new Error(`NS ${status}: ${detail}`);
  }
}

module.exports = { nsRequest };