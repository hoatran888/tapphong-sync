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

async function nsRequest(method, url, body = null) {
  const requestData = { url, method };
  const token       = { key: TOKEN_KEY, secret: TOKEN_SECRET };
  const authHeader  = oauth.toHeader(oauth.authorize(requestData, token));

  authHeader.Authorization += `, realm="${NS_ACCOUNT}"`;

  const res = await axios({
    method,
    url,
    data:         body,
    maxRedirects: 0,   // expose redirect errors instead of silently following
    headers: {
      ...authHeader,
      'Content-Type': 'application/json',
    },
  });

  return res.data;
}

module.exports = { nsRequest };