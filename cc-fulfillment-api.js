// Read-only CartonCloud outbound-order lifecycle inspector.
require('dotenv').config();
const axios = require('axios');
const productsUrl = process.env.CC_BASE_URL || '';
if (!/\/tenants\/[^/]+\/products\/?$/.test(productsUrl)) {
  throw new Error('CC_BASE_URL must end with /tenants/<tenantId>/products');
}
const outboundUrl = productsUrl.replace(/\/products\/?$/, '/outbound-orders');
const authUrl = process.env.CC_AUTH_URL || 'https://api.na.cartoncloud.com/uaa/oauth2/token';
let tokenInfo = { token: '', expiry: 0 };
async function token() {
  if (tokenInfo.token && Date.now() < tokenInfo.expiry - 60000) return tokenInfo.token;
  const response = await axios.post(authUrl, new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.CC_FULFILLMENT_CLIENT_ID,
    client_secret: process.env.CC_FULFILLMENT_CLIENT_SECRET
  }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000 });
  tokenInfo = { token: response.data.access_token, expiry: Date.now() + (response.data.expires_in || 3600) * 1000 };
  return tokenInfo.token;
}
async function getOrderLifecycle(ccId) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(ccId)) throw new Error('Invalid CartonCloud order UUID');
  const response = await axios.get(`${outboundUrl}/${encodeURIComponent(ccId)}`, {
    headers: { Authorization: `Bearer ${await token()}`, 'Accept-Version': '8', Prefer: 'return=lifecycle' },
    timeout: 20000
  });
  return response.data?.data || response.data;
}
module.exports = { getOrderLifecycle };
