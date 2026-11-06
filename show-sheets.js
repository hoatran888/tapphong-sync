const XLSX = require('xlsx');
const wb = XLSX.readFile('Data/TP-Info-v2.xlsx');
for (const name of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 });
  const headers = (rows[0] || []).filter(Boolean);
  console.log(`\n── ${name} ──`);
  headers.forEach((h, i) => console.log(`  ${i + 1}. ${h}`));
}
