require('dotenv').config();
const axios = require('axios');

(async () => {
  const r = await axios.post(process.env.CC_AUTH_URL, new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     process.env.CC_CLIENT_ID,
    client_secret: process.env.CC_CLIENT_SECRET,
  }));
  const token   = r.data.access_token;
  const headers = { Authorization: `Bearer ${token}`, 'Accept-Version': '8' };
  const base    = process.env.CC_BASE_URL.replace('/products', '');

  // Fetch existing outbound orders via search endpoint
  const res = await axios.post(base + '/outbound-orders/search', {
    condition: { type: 'AndCondition', conditions: [] }
  }, { headers });

  const orders = (res.data?.data || res.data || []).slice(0, 5);
  for (const o of orders) {
    console.log(`\nOrder: ${o.id}  ref: ${o.references?.customer}`);
    console.log(`  deliver.address:`, JSON.stringify(o.details?.deliver?.address, null, 2));
  }
})().catch(e => { console.error(e.response?.data || e.message); process.exit(1); });
