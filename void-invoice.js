require('dotenv').config();
const { nsRequest } = require('./ns-tba');

const NS_HOST = `https://${process.env.NS_ACCOUNT.toLowerCase().replace('_', '-')}.suitetalk.api.netsuite.com`;

async function voidInvoice(invoiceId) {
  const url = `${NS_HOST}/services/rest/record/v1/invoice/${invoiceId}`;
  await nsRequest('DELETE', url);
  console.log(`Invoice ${invoiceId} voided/deleted successfully`);
}

const idArg = process.argv.find(a => a.startsWith('--id='));
if (!idArg) {
  console.error('Usage: node void-invoice.js --id=2176');
  process.exit(1);
}

voidInvoice(idArg.split('=')[1]).catch(err => { console.error('Error:', err.message); process.exit(1); });
