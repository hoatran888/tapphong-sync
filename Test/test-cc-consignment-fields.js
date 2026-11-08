require('dotenv').config();
const axios = require('axios');

const CC_AUTH_URL  = process.env.CC_AUTH_URL;
const CC_TENANT_ID = process.env.CC_TENANT_ID;
const CC_CONSIGNMENTS = `https://api.na.cartoncloud.com/tenants/${CC_TENANT_ID}/consignments`;

async function main() {
  const res = await axios.post(CC_AUTH_URL, new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     process.env.CC_FULFILLMENT_CLIENT_ID,
    client_secret: process.env.CC_FULFILLMENT_CLIENT_SECRET,
  }));
  const token   = res.data.access_token;
  const headers = { Authorization: `Bearer ${token}`, 'Accept-Version': '8', 'Content-Type': 'application/json' };

  // Fetch first page — find one that is DELIVERED
  const search = await axios.post(`${CC_CONSIGNMENTS}/search?page=0&size=50`, {
    condition: { type: 'AndCondition', conditions: [] }
  }, { headers });
  const items = search.data?.content || (Array.isArray(search.data) ? search.data : []);

  const delivered = items.find(c => ['DELIVERED','COLLECTED','DELIVERED_TO_WAREHOUSE'].includes(c.status));
  const sample    = delivered || items[0];

  if (!sample) { console.log('No consignments found'); return; }

  console.log(`\n=== Consignment ${sample.id} (status: ${sample.status}) full JSON ===`);
  console.log(JSON.stringify(sample, null, 2));

  console.log('\n=== All top-level keys:', Object.keys(sample));

  const fields = ['timestamps', 'signature', 'pod', 'tracking', 'driver', 'photos', 'attachments', 'proofOfDelivery', 'deliveryProof'];
  for (const f of fields) {
    if (sample[f] !== undefined) console.log(`\n${f}:`, JSON.stringify(sample[f], null, 2));
    else console.log(`${f}: (not present)`);
  }
}

main().catch(console.error);
