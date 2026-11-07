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

async function sendDeliveredEmail({ to, customerName, soNumber, date }) {
  const subject = `Your order ${soNumber} has been delivered`;
  const text = `Dear ${customerName},

Your order ${soNumber} was successfully delivered on ${date}.

Thank you for your business.

Tap Phong Trading Co. Inc.`;

  await transporter.sendMail({ from: process.env.SMTP_USER, to, subject, text });
  console.log(`Email sent (delivered) → ${to}`);
}

module.exports = { sendShippedEmail, sendDeliveredEmail };
