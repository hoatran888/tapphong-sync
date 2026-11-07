require('dotenv').config();
const axios = require('axios');

const CC_AUTH_URL = process.env.CC_AUTH_URL;
const CC_TENANT_ID = process.env.CC_TENANT_ID;
const CC_BASE = `https://api.na.cartoncloud.com/tenants/${CC_TENANT_ID}`;
const CC_OUTBOUND = `${CC_BASE}/outbound-orders`;
const CC_SO_ID = process.env.CC_SO_1005_ID;

async function getToken(clientId, clientSecret) {
  const res = await axios.post(CC_AUTH_URL, new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  }));
  return res.data.access_token;
}

async function tryRequest(method, url, body, token) {
  try {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept-Version': '8' };
    const res = method === 'POST'
      ? await axios.post(url, body, { headers })
      : await axios.patch(url, body, { headers });
    console.log('OK', res.status, JSON.stringify(res.data).slice(0, 200));
  } catch (err) {
    console.error('ERR', err.response?.status, JSON.stringify(err.response?.data || err.message).slice(0, 300));
  }
}

async function main() {
  const token = await getToken(process.env.CC_FULFILLMENT_CLIENT_ID, process.env.CC_FULFILLMENT_CLIENT_SECRET);
  const base = `${CC_OUTBOUND}/${CC_SO_ID}`;

  console.log('\n1. PATCH lifecycleStatus:');
  await tryRequest('PATCH', base, { lifecycleStatus: 'DELIVERED' }, token);

  console.log('\n2. POST /deliver:');
  await tryRequest('POST', `${base}/deliver`, {}, token);

  console.log('\n3. POST /complete:');
  await tryRequest('POST', `${base}/complete`, {}, token);

  console.log('\n4. POST /delivered:');
  await tryRequest('POST', `${base}/delivered`, {}, token);

  console.log('\n5. PATCH status with fulfillment token:');
  await tryRequest('PATCH', base, { status: 'DELIVERED' }, token);

  console.log('\n6. POST /dispatch:');
  await tryRequest('POST', `${base}/dispatch`, {}, token);
}

main();
