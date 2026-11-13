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

  // Find all AWAITING_STOCK outbound orders and try to allocate them
  const outboundUrl = process.env.CC_BASE_URL.replace('/products', '/outbound-orders');
  const res = await axios.post(outboundUrl + '/search', {
    condition: { type: 'AndCondition', conditions: [] }
  }, { headers });

  const orders = (res.data?.data || res.data || []).filter(o => o.status === 'AWAITING_STOCK');
  console.log(`Found ${orders.length} AWAITING_STOCK order(s)\n`);

  for (const o of orders) {
    console.log(`Allocating ${o.references?.customer} (${o.id})...`);
    try {
      const r = await axios.patch(`${outboundUrl}/${o.id}`, { status: 'PICK_AND_PACK' }, { headers });
      console.log(`  OK:`, r.data?.status || JSON.stringify(r.data));
    } catch (e) {
      console.log(`  Failed ${e.response?.status}: ${JSON.stringify(e.response?.data)}`);
    }
  }
})().catch(e => { console.error(e.response?.data || e.message); process.exit(1); });
