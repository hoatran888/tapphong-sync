require('dotenv').config();
const { nsRequest } = require('./ns-tba');
const NS_ACCOUNT = (process.env.NS_ACCOUNT || '').replace(/_/g, '-').toLowerCase();

(async () => {
  const res = await nsRequest('POST',
    `https://${NS_ACCOUNT}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
    { q: "SELECT id, tranid, entity FROM purchaseorder ORDER BY entity" },
    { Prefer: 'transient' }
  );
  console.log(JSON.stringify(res.items, null, 2));
})().catch(e => console.error(e.response?.data || e.message));
