require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { createPO }          = require('./call-create-po');
const { upsertInboundOrder } = require('./cartoncloud');

// ── read and group PO sheet rows by poNumber ──────────────────────────────────

function readPOSheet(filePath) {
  const wb    = XLSX.readFile(filePath);
  const sheet = wb.Sheets['PO'];
  if (!sheet) throw new Error(`"PO" sheet not found in ${filePath}`);
  return XLSX.utils.sheet_to_json(sheet, { cellDates: true });
}


function normalizeExcelDate(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing ${fieldName}`);
  }

  let date;

  if (typeof value === 'number') {
    // Excel 1900 date system
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid Excel ${fieldName}: ${value}`);
    }

    date = new Date(
      Date.UTC(1899, 11, 30) +
      Math.floor(value) * 86400000
    );
  } else if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'string') {
    const text = value.trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      throw new Error(
        `Invalid ${fieldName}: ${text}. Expected YYYY-MM-DD`
      );
    }

    date = new Date(`${text}T00:00:00Z`);
    if (date.toISOString().slice(0, 10) !== text) {
      throw new Error(`Invalid ${fieldName}: ${text}`);
    }
  } else {
    throw new Error(`Unsupported ${fieldName} value`);
  }

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }

  return date.toISOString().slice(0, 10);
}


function groupByPO(rows) {
  const poMap = {};
  for (const row of rows) {
    const poNumber = row.poNumber;
    if (!poNumber) continue;
    if (!poMap[poNumber]) {
      poMap[poNumber] = {
        poNumber,
        vendorId:     row.vendorId     || '',
        vendorName:   row.vendorName   || '',
        // tranDate:     row.tranDate     || '',
        // shipDate:     row.shipDate     || '',
        tranDate: normalizeExcelDate(row.tranDate, 'tranDate'),
        shipDate: row.shipDate
                      ? normalizeExcelDate(row.shipDate, 'shipDate')
                      : '',
        locationId:   row.locationId   || '',
        subsidiaryId: row.subsidiaryId || '',
        memo:         row.memo         || '',
        taxCode:      row.taxCode      || 'CA-E',
        ccCustomerId: row.ccCustomerId || '',
        autoApprove:  (String(row.autoApprove || '').toLowerCase() === 'yes'),
        lines: [],
      };
    }
    if (row.sku) {
      poMap[poNumber].lines.push({
        sku:         row.sku         || '',
        description: row.description || '',
        quantity:    Number(row.quantity || 0),
        rate:        Number(row.rate     || 0),
        units:       row.units       || '',
        locationId:  row.locationId  || '',
      });
    }
  }
  return Object.values(poMap);
}

// ── main ──────────────────────────────────────────────────────────────────────

const inputFile = process.argv[2];
const poFlag    = process.argv.find(a => a.startsWith('--po='));
const filterPOs = poFlag ? poFlag.split('=')[1].split(',').map(s => s.trim()) : null;

const OUTPUT_DIR  = path.join(__dirname, 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'create-po-result.json');

if (!inputFile) {
  console.error('Usage:');
  console.error('  node run-po.js <file>                                      — create all POs');
  console.error('  node run-po.js <file> --po=PO-2026-001                    — create one PO');
  console.error('  node run-po.js <file> --po=PO-2026-001,PO-2026-002        — create multiple POs');
  process.exit(1);
}

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

(async () => {
  const rows   = readPOSheet(inputFile);
  const allPOs = groupByPO(rows);
  const pos    = filterPOs
    ? allPOs.filter(p => filterPOs.includes(p.poNumber))
    : allPOs;

  if (filterPOs && pos.length === 0) {
    console.error(`PO(s) "${filterPOs.join(', ')}" not found in file.`);
    process.exit(1);
  }

  console.log(`Found ${pos.length} PO(s). Sending to NetSuite + CartonCloud...\n`);
  const results = [];

  for (const po of pos) {
    console.log(`Processing ${po.poNumber} — vendor: ${po.vendorName || po.vendorId} — ${po.lines.length} line(s)`);
    const result = { poNumber: po.poNumber, netsuite: {}, cartoncloud: {} };
    // Debug Date
    console.log('\n===== PO DATE DEBUG =====');
console.log('PO:', po.poNumber);
console.log('tranDate:', po.tranDate);
console.log('tranDate type:', typeof po.tranDate);
console.log('tranDate is Date:', po.tranDate instanceof Date);
console.log('shipDate:', po.shipDate);
console.log('=========================\n');

    // ── NetSuite ──
    try {
      const res = await createPO(po);
      if (!res?.success) throw new Error(res?.error || 'Unknown NS error');
      result.netsuite = { status: 'ok', internalId: res.internalId, action: res.action };
      console.log(`NS   OK   ${po.poNumber}  →  internalId: ${res.internalId} (${res.action})`);
    } catch (err) {
      result.netsuite = { status: 'error', error: err.message, detail: err.response?.data };
      console.error(`NS   ERR  ${po.poNumber}  →  ${err.message}`);
      console.error(`NS   DETAIL:`, JSON.stringify(err.response?.data, null, 2));
    }

    // ── CartonCloud inbound order ──
    try {
      const ccRes = await upsertInboundOrder(po);
      result.cartoncloud = { status: 'ok', action: ccRes.action, ccId: ccRes.ccId, ccNumericId: ccRes.ccNumericId };
      console.log(`CC   OK   ${po.poNumber}  →  ccId: ${ccRes.ccId}, numericId: ${ccRes.ccNumericId} (${ccRes.action})`);
    } catch (err) {
      result.cartoncloud = { status: 'error', error: err.message, detail: err.response?.data };
      console.error(`CC   ERR  ${po.poNumber}  →  ${err.message}`);
      console.error(`CC   DETAIL:`, JSON.stringify(err.response?.data, null, 2));
    }

    results.push(result);
    console.log('');
  }

  const existing = fs.existsSync(OUTPUT_FILE) ? JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')) : [];
  const merged   = [...existing];
  for (const r of results) {
    const idx = merged.findIndex(e => e.poNumber === r.poNumber);
    if (idx >= 0) merged[idx] = r; else merged.push(r);
  }
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(merged, null, 2));
  const nsOk = results.filter(r => r.netsuite.status   === 'ok').length;
  const ccOk = results.filter(r => r.cartoncloud.status === 'ok').length;
  const total = results.length;
  console.log(`Done. NetSuite: ${nsOk}/${total} ok  |  CartonCloud: ${ccOk}/${total} ok`);
  console.log(`Results saved to: ${OUTPUT_FILE}`);
})();
