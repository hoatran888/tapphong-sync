require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { upsertInboundOrder } = require('./cartoncloud-bk');

function readPOSheet(filePath) {
  const wb    = XLSX.readFile(filePath);
  const sheet = wb.Sheets['PO'];
  if (!sheet) throw new Error(`"PO" sheet not found in ${filePath}`);
  return XLSX.utils.sheet_to_json(sheet);
}

function groupByPO(rows) {
  const poMap = {};
  for (const row of rows) {
    const poNumber = row.poNumber;
    if (!poNumber) continue;
    if (!poMap[poNumber]) {
      poMap[poNumber] = {
        poNumber,
        vendorName:      row.vendorName      || '',
        tranDate:        row.tranDate        || '',
        shipDate:        row.shipDate        || '',
        memo:            row.memo            || '',
        ccCustomerCode:  row.ccCustomerCode  || '',
        lines: [],
      };
    }
    if (row.sku) {
      poMap[poNumber].lines.push({
        sku:      row.sku,
        quantity: Number(row.quantity || 0),
        units:    row.units || 'EA',
      });
    }
  }
  return Object.values(poMap);
}

// ── main ──────────────────────────────────────────────────────────────────────

const inputFile = process.argv[2];
const poFlag    = process.argv.find(a => a.startsWith('--po='));
const filterPO  = poFlag ? poFlag.split('=')[1] : null;

const OUTPUT_DIR  = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'create-inbound-result.json');

if (!inputFile) {
  console.error('Usage:');
  console.error('  node run-inbound.js <file>                    — create all inbound orders');
  console.error('  node run-inbound.js <file> --po=PO-2026-001  — create single inbound order');
  process.exit(1);
}

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

(async () => {
  const rows   = readPOSheet(inputFile);
  const allPOs = groupByPO(rows);
  const pos    = filterPO
    ? allPOs.filter(p => p.poNumber === filterPO)
    : allPOs;

  if (filterPO && pos.length === 0) {
    console.error(`PO "${filterPO}" not found in file.`);
    process.exit(1);
  }

  console.log(`Found ${pos.length} PO(s). Sending inbound orders to CartonCloud...\n`);
  const results = [];

  for (const po of pos) {
    console.log(`Processing ${po.poNumber} — ${po.lines.length} line(s)`);
    try {
      const res = await upsertInboundOrder(po);
      results.push({ poNumber: po.poNumber, status: 'ok', ccId: res.ccId, action: res.action });
      console.log(`CC   OK   ${po.poNumber}  →  ccId: ${res.ccId} (${res.action})\n`);
    } catch (err) {
      results.push({ poNumber: po.poNumber, status: 'error', error: err.message, detail: err.response?.data });
      console.error(`CC   ERR  ${po.poNumber}  →  ${err.message}`);
      console.error(`CC   DETAIL:`, JSON.stringify(err.response?.data, null, 2), '\n');
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  const ok = results.filter(r => r.status === 'ok').length;
  console.log(`Done. ${ok}/${results.length} inbound order(s) ok`);
  console.log(`Results saved to: ${OUTPUT_FILE}`);
})();
