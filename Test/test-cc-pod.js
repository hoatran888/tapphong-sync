require('dotenv').config();
const axios = require('axios');

const CC_AUTH_URL     = process.env.CC_AUTH_URL;
const CC_TENANT_ID    = process.env.CC_TENANT_ID;
const BASE            = `https://api.na.cartoncloud.com/tenants/${CC_TENANT_ID}`;
const CONSIGNMENT_ID  = '9799c575-fe58-4263-87b1-e68f0fb284f2'; // known DELIVERED consignment

async function getToken() {
  const r = await axios.post(CC_AUTH_URL, new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     process.env.CC_FULFILLMENT_CLIENT_ID,
    client_secret: process.env.CC_FULFILLMENT_CLIENT_SECRET,
  }));
  return r.data.access_token;
}

async function tryGet(url, headers) {
  try {
    const r = await axios.get(url, { headers });
    return r.data;
  } catch (e) {
    return `ERR ${e.response?.status}: ${JSON.stringify(e.response?.data || e.message).slice(0, 300)}`;
  }
}

async function main() {
  const token   = await getToken();
  const headers = { Authorization: `Bearer ${token}`, 'Accept-Version': '8', 'Content-Type': 'application/json' };

  const endpoints = [
    `/consignments/${CONSIGNMENT_ID}`,
    `/consignments/${CONSIGNMENT_ID}/pod`,
    `/consignments/${CONSIGNMENT_ID}/signature`,
    `/consignments/${CONSIGNMENT_ID}/photos`,
    `/consignments/${CONSIGNMENT_ID}/attachments`,
    `/consignments/${CONSIGNMENT_ID}/documents`,
    `/consignments/${CONSIGNMENT_ID}/proof-of-delivery`,
  ];

  for (const ep of endpoints) {
    console.log(`\n--- GET ${ep} ---`);
    const data = await tryGet(`${BASE}${ep}`, headers);
    console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  }
}

main().catch(console.error);
