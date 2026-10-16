// run.js
const fs   = require('fs');
const path = require('path');
const { createItem } = require('./call-create-item');

const itemData = {
  sku:             'ITEM-001',
  displayName:     'Widget A',
  barcode:         '012345678901',
  uomInternalId:   1,
  weightKg:        0.5,
  lengthCm:        10,
  widthCm:         8,
  heightCm:        5,
  retailPrice:     29.99,
  costPrice:       12.00,
  casePackQty:     12,
  assetAccountId:  123,
  incomeAccountId: 456,
  cogsAccountId:   789,
  cartonCloudId:   'CC-9001',
  lifecycleStatus: 'Active',
};

const OUTPUT_FILE = path.join(__dirname, 'output', 'create-item-result.json');

(async () => {
  try {
    console.log('Calling NetSuite Suitelet...');
    const result = await createItem(itemData);

    const output = {
      timestamp: new Date().toISOString(),
      request:   itemData,
      response:  result,
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log('Success! Response saved to:', OUTPUT_FILE);
    console.log('NetSuite internalId:', result.internalId);

  } catch (err) {
    const errorOutput = {
      timestamp: new Date().toISOString(),
      request:   itemData,
      error: {
        message: err.message,
        status:  err.response?.status,
        data:    err.response?.data,
      },
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(errorOutput, null, 2));
    console.error('Failed. Error saved to:', OUTPUT_FILE);
    console.error(err.message);
    process.exit(1);
  }
})();
