require('dotenv').config();
const axios = require('axios');

const CC_AUTH_URL   = process.env.CC_AUTH_URL;
const CLIENT_ID     = process.env.CC_CLIENT_ID;
const CLIENT_SECRET = process.env.CC_CLIENT_SECRET;
const CC_OUTBOUND   = (process.env.CC_BASE_URL || '').replace('/products', '/outbound-orders');

const ccId = process.argv[2];
if (!ccId) { console.error('Usage: node test-cc-dispatch.js <ccId>'); process.exit(1); }

(async () => {
  // Get token
  const tokenRes = await axios.post(CC_AUTH_URL,
    new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  const token   = tokenRes.data.access_token;
  const headers = { Authorization: `Bearer ${token}`, 'Accept-Version': '8', 'Content-Type': 'application/json' };

  // Try different dispatch endpoints
  const attempts = [
    () => axios.patch(`${CC_OUTBOUND}/${ccId}`, { status: 'DISPATCHED' }, { headers }),
    () => axios.post(`${CC_OUTBOUND}/${ccId}/dispatch`, {}, { headers }),
    () => axios.put(`${CC_OUTBOUND}/${ccId}/status`, { status: 'DISPATCHED' }, { headers }),
  ];

  for (const attempt of attempts) {
    try {
      const res = await attempt();
      console.log('Success:', JSON.stringify(res.data, null, 2));
      break;
    } catch (e) {
      console.log(`Failed: ${e.response?.status} - ${JSON.stringify(e.response?.data)}`);
    }
  }
})().catch(e => console.error('Error:', e.response?.data || e.message));
