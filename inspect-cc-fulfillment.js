// Run: node inspect-cc-fulfillment.js --so=SO-2026-1004

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getOrderLifecycle } = require('./cc-fulfillment-api');

// ======================================================
// FUNCTION 1: Append an inspection to cc-fulfillment.json
// ======================================================

function appendFulfillmentJSON(report) {

  const outputDir = path.join(__dirname, 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  const outputFile = path.join(outputDir, 'cc-fulfillment.json');

  let history = [];

  // Read previous inspection records
  if (fs.existsSync(outputFile)) {

    const content = fs.readFileSync(outputFile, 'utf8').trim();

    if (content) {
      history = JSON.parse(content);

      if (!Array.isArray(history)) {
        throw new Error(
          'cc-fulfillment.json must contain a JSON array'
        );
      }
    }
  }

  // Add the new inspection record
  history.push({
    inspectedAt: new Date().toISOString(),
    ...report
  });

  // Save all records as valid, formatted JSON
  fs.writeFileSync(
    outputFile,
    JSON.stringify(history, null, 2),
    'utf8'
  );

  console.log(`History saved to: ${outputFile}`);
  console.log(`Total inspections: ${history.length}`);
}

// ======================================================
// MAIN PROGRAM: Runs automatically
// ======================================================

const so = process.argv
  .find(arg => arg.startsWith('--so='))
  ?.slice(5);

if (!so) {
  console.error(
    'Usage: node inspect-cc-fulfillment.js --so=SO-2026-1004'
  );
  process.exit(1);
}

(async () => {

  // 1. Read NetSuite / CartonCloud order mappings

  const input = path.join(
    __dirname,
    'output',
    'create-so-result.json'
  );

  const results = JSON.parse(
    fs.readFileSync(input, 'utf8')
  );

  const entries = Array.isArray(results)
    ? results
    : [results];

  const entry = entries.find(
    row => row.soNumber === so
  );

  if (
    !entry ||
    entry.netsuite?.status !== 'ok' ||
    entry.cartoncloud?.status !== 'ok' ||
    !entry.cartoncloud.ccId
  ) {
    throw new Error(
      `No successful NetSuite/CartonCloud order mapping for ${so}`
    );
  }

  // 2. Retrieve CartonCloud order lifecycle

  const order = await getOrderLifecycle(
    entry.cartoncloud.ccId
  );

  // 3. Validate order identity

  if (
    order.id &&
    order.id !== entry.cartoncloud.ccId
  ) {
    throw new Error('CartonCloud order ID mismatch');
  }

  if (
    order.references?.customer &&
    order.references.customer !== so
  ) {
    throw new Error('CartonCloud SO reference mismatch');
  }

  // 4. Build inspection report

  const report = {
    soNumber: so,
    ccId: entry.cartoncloud.ccId,
    status: order.status,
    lifecycleState: order.lifecycleState || null,
    items: order.items || null,
    order
  };

  // ====================================================
  // 5. CALL appendFulfillmentJSON() HERE — ONLY ONCE
  // ====================================================

  appendFulfillmentJSON(report);

  // 6. Save the latest snapshot (existing functionality)

  const output = path.join(
    __dirname,
    'output',
    `cc-lifecycle-${so.replace(/[^a-z0-9_-]/gi, '_')}.json`
  );

  fs.writeFileSync(
    output,
    JSON.stringify(report, null, 2),
    'utf8'
  );

  // 7. Display results

  console.log(`SO: ${so}`);
  console.log(`CC UUID: ${entry.cartoncloud.ccId}`);
  console.log(`Status: ${order.status}`);

  console.log(
    'Available lifecycle actions:',
    JSON.stringify(order.lifecycleState?.actions || {}, null, 2)
  );

  console.log(`Full response saved to ${output}`);

  console.log(
    'READ-ONLY: No inventory or order status changes performed.'
  );

})().catch(err => {

  console.error(
    'CartonCloud inspection failed:',
    err.response?.status || '',
    JSON.stringify(err.response?.data || err.message)
  );

  process.exitCode = 1;
});