require('dotenv').config();
const { getSOInfo }    = require('../call-get-so-info');
const { sendShippedEmail, sendDeliveredEmail } = require('../send-email');

async function main() {
  const info = await getSOInfo('SO-2026-1005');
  console.log('SO info:', JSON.stringify(info, null, 2));

  console.log('\nSending shipped email...');
  await sendShippedEmail({ to: info.customerEmail, customerName: info.customerName, soNumber: info.soNumber, items: info.items, trackingRef: 'CC-TEST-001' });

  console.log('\nSending delivered email...');
  await sendDeliveredEmail({
    to:               info.customerEmail,
    customerName:     info.customerName,
    soNumber:         info.soNumber,
    date:             '2026-11-08',
    driverName:       'Brandon Luu',
    deliveredAt:      '2026-11-08T14:35:00-05:00',
    carrier:          'Tap Phong Trading Company',
    vehicle:          'HINO Truck (Large)',
    signatureCaptured: true,
    consignmentRef:   '42',
    trackingLabels:   ['TPH0000001001', 'TPH0000001002', 'TPH0000001003'],
  });
}

main().catch(console.error);
