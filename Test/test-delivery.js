const http = require('http');

const payloads = {
  failed: { type: 'OUTBOUND', status: 'FAILED', id: 'test-003', references: { customer: 'SO-2026-1005' }, notes: 'Customer not home', items: [] },
  rescheduled: { type: 'OUTBOUND', status: 'RESCHEDULED', id: 'test-004', references: { customer: 'SO-2026-1005' }, notes: 'Customer requested new date', newDate: '2026-11-10', items: [] },
};

const name = process.argv[2] || 'failed';
const body = JSON.stringify(payloads[name]);

const req = http.request({ host: 'localhost', port: 3000, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => console.log('Response:', data));
});
req.on('error', e => console.error('Error:', e.message));
req.write(body);
req.end();
