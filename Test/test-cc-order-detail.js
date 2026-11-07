require('dotenv').config();
const axios = require('axios');

const CC_AUTH_URL = process.env.CC_AUTH_URL;
const CC_OUTBOUND = process.env.CC_BASE_URL.replace(/\/products\/?$/, '/outbound-orders');
const CC_SO_ID = process.env.CC_SO_1005_ID;

async function getToken(id, secret) {
  const res = await axios.post(CC_AUTH_URL, new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: id || process.env.CC_CLIENT_ID,
    client_secret: secret || process.env.CC_CLIENT_SECRET,
  }));
  return res.data.access_token;
}

async function tryGet(url, headers) {
  try {
    const res = await axios.get(url, { headers });
    return res.data;
  } catch (e) {
    return `ERR ${e.response?.status}: ${JSON.stringify(e.response?.data || e.message).slice(0, 200)}`;
  }
}

async function tryPost(url, body, headers) {
  try {
    const res = await axios.post(url, body, { headers });
    return res.data;
  } catch (e) {
    return `ERR ${e.response?.status}: ${JSON.stringify(e.response?.data || e.message).slice(0, 200)}`;
  }
}

async function main() {
  const token = await getToken();
  const headers = { Authorization: `Bearer ${token}`, 'Accept-Version': '8', 'Content-Type': 'application/json' };
  const CC_TENANT_ID = process.env.CC_TENANT_ID;
  const CC_CONSIGNMENTS = `https://api.na.cartoncloud.com/tenants/${CC_TENANT_ID}/consignments`;

  // Try with fulfillment credentials
  const fToken = await getToken(process.env.CC_FULFILLMENT_CLIENT_ID, process.env.CC_FULFILLMENT_CLIENT_SECRET);
  const fHeaders = { Authorization: `Bearer ${fToken}`, 'Accept-Version': '8', 'Content-Type': 'application/json' };

  console.log('\n1. POST /consignments/search (fulfillment creds):');
  console.log(JSON.stringify(await tryPost(`${CC_CONSIGNMENTS}/search`, { condition: { type: 'AndCondition', conditions: [] } }, fHeaders), null, 2));

  console.log('\n2. GET /consignments/1221 (fulfillment creds):');
  console.log(JSON.stringify(await tryGet(`${CC_CONSIGNMENTS}/1221`, fHeaders), null, 2));

  console.log('\n3. Order details, timestamps, measures:');
  const order = await tryGet(`${CC_OUTBOUND}/${CC_SO_ID}`, headers);
  console.log('details:', JSON.stringify(order.details, null, 2));
  console.log('timestamps:', JSON.stringify(order.timestamps, null, 2));
  console.log('measures:', JSON.stringify(order.measures, null, 2));
}

main().catch(console.error);
