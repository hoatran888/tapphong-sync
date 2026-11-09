require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { createInvoice } = require('./call-create-invoice');

const OUTPUT_DIR  = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'invoice-result.json');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

function saveResult(result) {
  const existing = fs.existsSync(OUTPUT_FILE) ? JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')) : [];
  const idx = existing.findIndex(r => r.soNumber === result.soNumber);
  if (idx >= 0) existing[idx] = result; else existing.push(result);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));
}

async function main() {
  // Accept --so=SO-2026-XXXX or list of SO numbers as args
  const args = process.argv.slice(2);
  const soArg = args.find(a => a.startsWith('--so='));
  const soNumbers = soArg
    ? [soArg.replace('--so=', '')]
    : args.filter(a => a.startsWith('SO-'));

  if (!soNumbers.length) {
    console.error('Usage: node run-invoice.js --so=SO-2026-1006');
    console.error('       node run-invoice.js SO-2026-1005 SO-2026-1006');
    process.exit(1);
  }

  for (const soNumber of soNumbers) {
    console.log(`Creating invoice for ${soNumber}...`);
    try {
      const res = await createInvoice(soNumber);
      const result = { soNumber, status: 'ok', internalId: res.internalId, action: res.action };
      console.log(`NS   OK   ${soNumber}  →  invoice internalId: ${res.internalId} (${res.action})`);
      saveResult(result);
    } catch (err) {
      const result = { soNumber, status: 'error', error: err.message };
      console.error(`NS   ERR  ${soNumber}  →  ${err.message}`);
      saveResult(result);
    }
  }

  console.log(`\nResults saved to: ${OUTPUT_FILE}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
