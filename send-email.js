require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

function itemsTable(items = []) {
  return items.map(i => `  - ${i.name}: ${i.qty}`).join('\n');
}

async function sendShippedEmail({ to, customerName, soNumber, items, trackingRef }) {
  const subject = `Your order ${soNumber} has been shipped`;
  const text = `Dear ${customerName},

Your order ${soNumber} has been shipped and is on its way.

Items shipped:
${itemsTable(items)}

Tracking reference: ${trackingRef || soNumber}

Thank you for your business.

Tap Phong Trading Co. Inc.`;

  await transporter.sendMail({ from: process.env.SMTP_USER, to, subject, text });
  console.log(`Email sent (shipped) → ${to}`);
}

function formatDeliveredAt(isoString) {
  if (!isoString) return null;
  try {
    return new Date(isoString).toLocaleString('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch { return isoString; }
}

async function sendDeliveredEmail({ to, customerName, soNumber, date,
  driverName, deliveredAt, carrier, vehicle, signatureCaptured,
  consignmentRef, trackingLabels, podUrl }) {

  const subject = `Your order ${soNumber} has been delivered`;

  const deliveryTime = formatDeliveredAt(deliveredAt) || date;
  const carrierLine  = carrier  ? `Carrier:    ${carrier}` : null;
  const vehicleLine  = vehicle  ? `Vehicle:    ${vehicle}` : null;
  const driverLine   = driverName ? `Driver:     ${driverName}` : null;
  const sigLine      = signatureCaptured != null
    ? `Signature:  ${signatureCaptured ? 'Captured' : 'Not captured'}` : null;
  const labelsLine   = trackingLabels?.length
    ? `Carton labels:\n${trackingLabels.map(l => `  ${l}`).join('\n')}` : null;
  const refLine      = consignmentRef ? `Consignment #: ${consignmentRef}` : null;
  const podLine      = podUrl ? `Proof of delivery: ${podUrl}` : null;

  const details = [carrierLine, vehicleLine, driverLine, sigLine, refLine, labelsLine, podLine]
    .filter(Boolean).join('\n');

  const text = `Dear ${customerName},

Your order ${soNumber} was successfully delivered on ${deliveryTime}.

${details}

Thank you for your business.

Tap Phong Trading Co. Inc.`;

  await transporter.sendMail({ from: process.env.SMTP_USER, to, subject, text });
  console.log(`Email sent (delivered) → ${to}`);
}

module.exports = { sendShippedEmail, sendDeliveredEmail };
