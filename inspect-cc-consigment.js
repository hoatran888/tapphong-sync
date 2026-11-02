#!/usr/bin/env node

// Read-only inspection of a CartonCloud consignment and its items.
// Usage:
// node inspect-cc-consignment.js --consignment=UUID

require('dotenv').config();

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// --------------------------------------------------
// 1. Read command-line parameter
// --------------------------------------------------

const arg = process.argv.find(x =>
  x.startsWith('--consignment=')
);

const consignmentId =
  arg?.slice('--consignment='.length) ||
  '0204f016-5231-43ed-99b3-71732e8bfd2b';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!uuidPattern.test(consignmentId)) {
  console.error('Invalid consignment UUID.');
  process.exit(1);
}

// --------------------------------------------------
// 2. CartonCloud API configuration
// --------------------------------------------------

const productsUrl =
  (process.env.CC_BASE_URL || '').replace(/\/$/, '');

if (!/\/tenants\/[^/]+\/products$/.test(productsUrl)) {
  console.error(
    'CC_BASE_URL must end with /tenants/<tenantId>/products'
  );
  process.exit(1);
}

const baseUrl = productsUrl.replace(/\/products$/, '');

const authUrl =
  process.env.CC_AUTH_URL ||
  'https://api.na.cartoncloud.com/uaa/oauth2/token';

// --------------------------------------------------
// 3. Main function
// --------------------------------------------------

async function main() {

  // Check OAuth credentials

  if (
    !process.env.CC_FULFILLMENT_CLIENT_ID ||
    !process.env.CC_FULFILLMENT_CLIENT_SECRET
  ) {
    throw new Error(
      'Missing CC_FULFILLMENT_CLIENT_ID or ' +
      'CC_FULFILLMENT_CLIENT_SECRET in .env'
    );
  }

  // ----------------------------------------------
  // 4. Request OAuth 2.0 access token
  // ----------------------------------------------

  const tokenResponse = await axios.post(
    authUrl,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id:
        process.env.CC_FULFILLMENT_CLIENT_ID,
      client_secret:
        process.env.CC_FULFILLMENT_CLIENT_SECRET
    }),
    {
      headers: {
        'Content-Type':
          'application/x-www-form-urlencoded'
      },
      timeout: 20000
    }
  );

  const headers = {
    Authorization:
      `Bearer ${tokenResponse.data.access_token}`,
    'Accept-Version': '8'
  };

  // ----------------------------------------------
  // 5. Build CartonCloud consignment URL
  // ----------------------------------------------

  const url =
    `${baseUrl}/consignments/${encodeURIComponent(consignmentId)}`;

  console.log(
    'READ-ONLY consignment:',
    consignmentId
  );

  const result = {
    consignmentId,
    retrievedAt: new Date().toISOString()
  };

  // ----------------------------------------------
  // 6. Retrieve consignment and its items
  // ----------------------------------------------

  for (const [key, target] of [
    ['consignment', url],
    ['items', `${url}/items`]
  ]) {

    try {

      const response = await axios.get(
        target,
        {
          headers,
          timeout: 20000
        }
      );

      result[key] = response.data;

      console.log(
        `${key}: HTTP ${response.status}`
      );

    } catch (err) {

      const status = err.response?.status;

      result[`${key}Error`] = {
        status: status || null,
        response:
          err.response?.data || err.message
      };

      console.log(
        `${key}: ${
          status ? `HTTP ${status}` : err.message
        }`
      );
    }
  }

  // ----------------------------------------------
  // 7. Save API responses to JSON
  // ----------------------------------------------

  const dir = path.join(
    process.cwd(),
    'output'
  );

  fs.mkdirSync(dir, {
    recursive: true
  });

  const file = path.join(
    dir,
    `cc-consignment-${consignmentId}.json`
  );

  fs.writeFileSync(
    file,
    JSON.stringify(result, null, 2)
  );

  console.log(
    'Saved response:',
    file
  );

  console.log(
    'No warehouse or order changes performed.'
  );
}

// --------------------------------------------------
// 8. Error handling
// --------------------------------------------------

main().catch(err => {

  console.error(
    'Inspection failed:',
    err.response?.status || '',
    JSON.stringify(
      err.response?.data || err.message
    )
  );

  process.exitCode = 1;
});