require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { createSO }           = require('./call-create-so');
const { upsertOutboundOrder } = require('./cartoncloud');

// ── read and group SO sheet rows by soNumber ──────────────────────────────────

function readSOSheet(filePath) {
  const wb    = XLSX.readFile(filePath);
  const sheet = wb.Sheets['SO'];
  if (!sheet) throw new Error(`"SO" sheet not found in ${filePath}`);
  return XLSX.utils.sheet_to_json(sheet, { cellDates: true });
}

function groupBySO(rows) {
  const soMap = {};
  for (const row of rows) {
    const soNumber = row.soNumber;
    if (!soNumber) continue;
    if (!soMap[soNumber]) {
      soMap[soNumber] = {
        soNumber,
        nsCustomerId:         row.nsCustomerId         || '',
        customerName:         row.customerName         || '',
        tranDate:             row.tranDate             || '',
        shipDate:             row.shipDate             || '',
        locationId:           row.locationId           || '',
        subsidiaryId:         row.subsidiaryId         || '3',
        memo:                 row.memo                 || '',
        packingInstructions:  row.packingInstructions  || '',
        deliveryInstructions: row.deliveryInstructions || '',
        ccDeliverAddressId:   row.ccDeliverAddressId   || '',
        ccCustomerId:         row.ccCustomerId         || '',
        autoApprove:          (String(row.autoApprove || '').toLowerCase() === 'yes') ? 'yes' : 'no',
        lines: [],
      };
    }
    if (row.sku) {
      soMap[soNumber].lines.push({
        sku:         row.sku         || '',
        description: row.description || '',
        quantity:    Number(row.quantity || 0),
        rate:        Number(row.rate     || 0),
        units:       row.units       || '',
        locationId:  row.locationId  || '',
      });
    }
  }
  return Object.values(soMap);
}

// ── main ──────────────────────────────────────────────────────────────────────

const inputFile = process.argv[2];
const soFlag    = process.argv.find(a => a.startsWith('--so='));
const filterSOs = soFlag ? soFlag.split('=')[1].split(',').map(s => s.trim()) : null;

const OUTPUT_DIR  = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'create-so-result.json');

if (!inputFile) {
  console.error('Usage:');
  console.error('  node run-so.js <file>                                      — create all SOs');
  console.error('  node run-so.js <file> --so=SO-2026-001                    — create one SO');
  console.error('  node run-so.js <file> --so=SO-2026-001,SO-2026-002        — create multiple SOs');
  process.exit(1);
}

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

(async () => {
  const rows   = readSOSheet(inputFile);
  const allSOs = groupBySO(rows);
  const sos    = filterSOs
    ? allSOs.filter(s => filterSOs.includes(s.soNumber))
    : allSOs;

  if (filterSOs && sos.length === 0) {
    console.error(`SO(s) "${filterSOs.join(', ')}" not found in file.`);
    process.exit(1);
  }

  console.log(`Found ${sos.length} SO(s). Sending to NetSuite + CartonCloud...\n`);
  const results = [];

  for (const so of sos) {
    console.log(`Processing ${so.soNumber} — customer: ${so.customerName || so.nsCustomerId} — ${so.lines.length} line(s)`);
    const result = { soNumber: so.soNumber, netsuite: {}, cartoncloud: {} };

    // ── NetSuite ──
    try {
      const res = await createSO(so);
      if (!res?.success) throw new Error(res?.error || 'Unknown NS error');
      result.netsuite = { status: 'ok', internalId: res.internalId, action: res.action };
      console.log(`NS   OK   ${so.soNumber}  →  internalId: ${res.internalId} (${res.action})`);
    } catch (err) {
      result.netsuite = { status: 'error', error: err.message, detail: err.response?.data };
      console.error(`NS   ERR  ${so.soNumber}  →  ${err.message}`);
      console.error(`NS   DETAIL:`, JSON.stringify(err.response?.data, null, 2));
    }

    // ── CartonCloud outbound order ──
    try {
      const ccRes = await upsertOutboundOrder(so);
      result.cartoncloud = { status: 'ok', action: ccRes.action, ccId: ccRes.ccId, ccNumericId: ccRes.ccNumericId };
      console.log(`CC   OK   ${so.soNumber}  →  ccId: ${ccRes.ccId}, numericId: ${ccRes.ccNumericId} (${ccRes.action})`);
    } catch (err) {
      result.cartoncloud = { status: 'error', error: err.message, detail: err.response?.data };
      console.error(`CC   ERR  ${so.soNumber}  →  ${err.message}`);
      console.error(`CC   DETAIL:`, JSON.stringify(err.response?.data, null, 2));
    }

    results.push(result);
    console.log('');
  }

  const existing = fs.existsSync(OUTPUT_FILE) ? JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')) : [];
  const merged   = [...existing];
  for (const r of results) {
    const idx = merged.findIndex(e => e.soNumber === r.soNumber);
    if (idx >= 0) merged[idx] = r; else merged.push(r);
  }
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(merged, null, 2));
  const nsOk  = results.filter(r => r.netsuite.status   === 'ok').length;
  const ccOk  = results.filter(r => r.cartoncloud.status === 'ok').length;
  const total = results.length;
  console.log(`Done. NetSuite: ${nsOk}/${total} ok  |  CartonCloud: ${ccOk}/${total} ok`);
  console.log(`Results saved to: ${OUTPUT_FILE}`);
})();
