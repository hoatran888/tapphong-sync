require('dotenv').config();
const { nsRequest } = require('./ns-tba');

const NS_ACCOUNT  = (process.env.NS_ACCOUNT || '').replace(/_/g, '-').toLowerCase();
const SCRIPT_ID   = process.env.NS_INV_ADJUSTMENT_SCRIPT_ID;
const DEPLOY_ID   = process.env.NS_INV_ADJUSTMENT_DEPLOY_ID || '1';

const RESTLET_URL = `https://${NS_ACCOUNT}.restlets.api.netsuite.com`
                  + `/app/site/hosting/restlet.nl`
                  + `?script=${SCRIPT_ID}&deploy=${DEPLOY_ID}`;

const DEFAULT_LOCATION_ID = process.env.NS_DEFAULT_LOCATION_ID || null;

// GL account IDs from .env — set these to your NS account internal IDs
const ACCOUNT_IDS = {
  CYCLE_COUNT: process.env.NS_ADJ_ACCOUNT_CYCLE_COUNT || null,
  DAMAGED:     process.env.NS_ADJ_ACCOUNT_DAMAGED     || null,
  LOST:        process.env.NS_ADJ_ACCOUNT_LOST        || null,
  FOUND:       process.env.NS_ADJ_ACCOUNT_FOUND       || null,
  WRITE_OFF:   process.env.NS_ADJ_ACCOUNT_WRITE_OFF   || null,
};

async function createInvAdjustment(options) {
  const { adjustmentType, sku, adjustQtyBy, newQuantity, locationId, memo, accountId } = options;

  const body = {
    adjustmentType,
    sku,
    locationId: locationId || null,
    memo,
    accountId:  accountId || ACCOUNT_IDS[adjustmentType],
  };

  if (adjustmentType === 'CYCLE_COUNT') {
    body.newQuantity = newQuantity;
  } else {
    body.adjustQtyBy = adjustQtyBy;
  }

  const res = await nsRequest('POST', RESTLET_URL, body);
  if (!res?.success) throw new Error(res?.error || 'Unknown NS adjustment error');
  return res;
}

module.exports = { createInvAdjustment };
