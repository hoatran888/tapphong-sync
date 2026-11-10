require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { createInvAdjustment } = require('./call-create-inv-adjustment');

const OUTPUT_DIR  = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'inv-adjustment-result.json');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

const USAGE = `
Usage: node run-inv-adjustment.js --type=TYPE --sku=SKU [options]

Adjustment Types:
  CYCLE_COUNT   Set absolute quantity after physical count
  DAMAGED       Reduce qty — goods damaged in warehouse
  LOST          Reduce qty — goods lost/missing
  FOUND         Increase qty — goods found/surplus
  WRITE_OFF     Reduce qty to zero or by amount — goods written off

Options:
  --type=TYPE           Required. One of: CYCLE_COUNT, DAMAGED, LOST, FOUND, WRITE_OFF
  --sku=SKU             Required. Item SKU (e.g. TP-2026-1006)
  --qty=NUMBER          Required for DAMAGED, LOST, FOUND, WRITE_OFF (negative reduces, positive adds)
  --newqty=NUMBER       Required for CYCLE_COUNT (absolute new quantity)
  --location=ID         Optional. NS location ID (defaults to NS_DEFAULT_LOCATION_ID)
  --account=ID          Optional. NS GL account ID override
  --memo=TEXT           Optional. Notes for the adjustment

Examples:
  node run-inv-adjustment.js --type=CYCLE_COUNT --sku=TP-2026-1006 --newqty=90
  node run-inv-adjustment.js --type=DAMAGED     --sku=TP-2026-1006 --qty=-5   --memo="Water damage"
  node run-inv-adjustment.js --type=LOST        --sku=TP-2026-1005 --qty=-2   --memo="Missing after count"
  node run-inv-adjustment.js --type=FOUND       --sku=TP-2026-1005 --qty=3    --memo="Found in back storage"
  node run-inv-adjustment.js --type=WRITE_OFF   --sku=TP-2026-1006 --qty=-10  --memo="Expired stock"
`;

function parseArgs() {
  const args = process.argv.slice(2);
  const get  = (prefix) => {
    const a = args.find(a => a.startsWith(prefix));
    return a ? a.replace(prefix, '') : null;
  };

  const type   = get('--type=');
  const sku    = get('--sku=');
  const qty    = get('--qty=');
  const newqty = get('--newqty=');
  const loc    = get('--location=');
  const acc    = get('--account=');
  const memo   = get('--memo=');

  if (!type || !sku) { console.error(USAGE); process.exit(1); }

  if (type === 'CYCLE_COUNT' && newqty == null) {
    console.error('ERROR: --newqty is required for CYCLE_COUNT\n'); process.exit(1);
  }
  if (type !== 'CYCLE_COUNT' && qty == null) {
    console.error(`ERROR: --qty is required for ${type}\n`); process.exit(1);
  }

  const skus = sku.split(',').map(s => s.trim());

  return skus.map(s => ({
    adjustmentType: type,
    sku:          s,
    adjustQtyBy:  qty    != null ? Number(qty)    : undefined,
    newQuantity:  newqty != null ? Number(newqty) : undefined,
    locationId:   loc,
    accountId:    acc,
    memo,
  }));
}

function saveResult(result) {
  const existing = fs.existsSync(OUTPUT_FILE) ? JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')) : [];
  existing.push({ ...result, timestamp: new Date().toISOString() });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));
}

async function main() {
  const allOptions = parseArgs();
  console.log(`Creating ${allOptions[0].adjustmentType} adjustment for ${allOptions.map(o => o.sku).join(', ')}...\n`);

  for (const options of allOptions) {
    try {
      const res    = await createInvAdjustment(options);
      const result = { ...options, status: 'ok', internalId: res.internalId, action: res.action };
      console.log(`NS   OK   ${options.sku}  →  adjustment internalId: ${res.internalId} (${res.action})`);
      saveResult(result);
    } catch (err) {
      const result = { ...options, status: 'error', error: err.message };
      console.error(`NS   ERR  ${options.sku}  →  ${err.message}`);
      saveResult(result);
    }
  }

  console.log(`\nResults saved to: ${OUTPUT_FILE}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
