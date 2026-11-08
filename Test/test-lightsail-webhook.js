const http = require('http');

const payload = JSON.stringify({
  type: 'OUTBOUND',
  status: 'DISPATCHED',
  id: 'test-lightsail-001',
  references: { customer: 'SO-2026-1005' },
});

const options = {
  hostname: '35.183.43.36',
  port: 3000,
  path: '/',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
};

const req = http.request(options, res => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => console.log('Response:', data));
});
req.on('error', err => console.error('Error:', err.message));
req.write(payload);
req.end();
