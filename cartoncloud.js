
 // cartoncloud.js
require('dotenv').config();
const axios = require('axios');

// ── Configuration ────────────────────────────────────

const CC_PRODUCTS = process.env.CC_BASE_URL || '';

const CC_WAREHOUSE = CC_PRODUCTS.replace(
  /\/products\/?$/,
  '/warehouse-products'
);

const CC_INBOUND = CC_PRODUCTS.replace(
  /\/products\/?$/,
  '/inbound-orders'
);

const CC_OUTBOUND = CC_PRODUCTS.replace(
  /\/products\/?$/,
  '/outbound-orders'
);

const CC_AUTH_URL =
  process.env.CC_AUTH_URL ||
  'https://api.na.cartoncloud.com/uaa/oauth2/token';

const CLIENT_ID = process.env.CC_CLIENT_ID;
const CLIENT_SECRET = process.env.CC_CLIENT_SECRET;
const CC_CUSTOMER_ID = process.env.CC_CUSTOMER_ID || '';
const CC_WAREHOUSE_ID = process.env.CC_WAREHOUSE_ID || '';

if (!CC_PRODUCTS) {
  throw new Error('Missing CC_BASE_URL in .env');
}

// ── Date formatting ──────────────────────────────────

function fmtDate(d) {
  if (!d) return undefined;

  const dt = d instanceof Date
    ? d
    : typeof d === 'number'
      ? new Date((d - 25569) * 86400 * 1000)
      : new Date(d);

  if (
    Number.isNaN(dt.getTime()) ||
    dt.getFullYear() < 1990
  ) {
    return undefined;
  }

  return [
    dt.getUTCFullYear(),
    String(dt.getUTCMonth() + 1).padStart(2, '0'),
    String(dt.getUTCDate()).padStart(2, '0')
  ].join('-');
}

// ── OAuth token cache ────────────────────────────────

let cachedToken = {
  value: null,
  expiresAt: 0
};

async function getToken() {
  if (
    cachedToken.value &&
    Date.now() < cachedToken.expiresAt - 60000
  ) {
    return cachedToken.value;
  }

  const res = await axios.post(
    CC_AUTH_URL,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );

  if (!res.data?.access_token) {
    throw new Error('CartonCloud returned no access token');
  }

  cachedToken = {
    value: res.data.access_token,
    expiresAt:
      Date.now() +
      Number(res.data.expires_in || 3600) * 1000
  };

  return cachedToken.value;
}

async function authHeaders() {
  const token = await getToken();

  return {
    Authorization: `Bearer ${token}`,
    'Accept-Version': '8',
    'Content-Type': 'application/json'
  };
}

// ── API response helpers ─────────────────────────────

function unwrapData(response) {
  return response?.data ?? response;
}

function getItems(response) {
  const body = unwrapData(response);

  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.data?.items)) {
    return body.data.items;
  }
  if (Array.isArray(body?.content)) return body.content;

  throw new Error(
    'Unexpected CartonCloud list response format. ' +
    'Creation stopped to prevent duplicates.'
  );
}

function getId(response) {
  const body = unwrapData(response);

  return (
    body?.id ||
    body?.data?.id ||
    body?.product_id ||
    null
  );
}

function sameSku(product, sku) {
  return String(
    product?.references?.code ??
    product?.code ??
    ''
  ) === String(sku);
}

// ── Product mapping ──────────────────────────────────

function mapItemToCC(item) {
  return {
    name: item.displayName,
    references: {
      code: item.sku,
      barcode: item.barcode
        ? String(item.barcode)
        : undefined
    },
    measures: {
      weight: item.weightKg || undefined
    },
    properties: {
      length: item.lengthCm || undefined,
      width: item.widthCm || undefined,
      height: item.heightCm || undefined
    },
    case_qty:
      item.piecesPerCarton ||
      item.casePackQty,

    status: item.lifecycleStatus || 'Active'
  };
}

// ── Transport product lookup ────────────────────────

async function getProductById(id, headers) {
  const res = await axios.get(
    `${CC_PRODUCTS}/${encodeURIComponent(id)}`,
    { headers }
  );

  return {
    product: unwrapData(res.data),
    etag: res.headers.etag || ''
  };
}

async function findProductBySku(sku, headers) {
  // Do not silently turn an HTTP error into "not found".
  const res = await axios.get(CC_PRODUCTS, {
    headers,
    params: { sku }
  });

  const items = getItems(res.data);
  return items.find(p => sameSku(p, sku)) || null;
}

// ── Transport product UPSERT ────────────────────────

async function upsertProduct(item) {
  if (!item?.sku) {
    throw new Error('Missing SKU');
  }

  const headers = await authHeaders();
  const payload = mapItemToCC(item);

  // Priority 1: ID already stored in Excel
  if (item.cartonCloudId) {
    const { product, etag } = await getProductById(
      item.cartonCloudId,
      headers
    );

    if (!sameSku(product, item.sku)) {
      throw new Error(
        `CartonCloud ID ${item.cartonCloudId} ` +
        `does not match SKU ${item.sku}`
      );
    }

    if (!etag) {
      throw new Error(
        'CartonCloud did not return an ETag. ' +
        'Update stopped for safety.'
      );
    }

    const res = await axios.put(
      `${CC_PRODUCTS}/${encodeURIComponent(item.cartonCloudId)}`,
      payload,
      {
        headers: {
          ...headers,
          'If-Match': etag
        }
      }
    );

    return {
      ccId: item.cartonCloudId,
      action: 'updated',
      data: res.data
    };
  }

  // Priority 2: search by SKU
  const existing = await findProductBySku(
    item.sku,
    headers
  );

  if (existing) {
    const existingId = existing.id;

    if (!existingId) {
      throw new Error(
        'Existing CartonCloud product has no ID'
      );
    }

    const { etag } = await getProductById(
      existingId,
      headers
    );

    if (!etag) {
      throw new Error(
        'CartonCloud did not return an ETag. ' +
        'Update stopped for safety.'
      );
    }

    const res = await axios.put(
      `${CC_PRODUCTS}/${encodeURIComponent(existingId)}`,
      payload,
      {
        headers: {
          ...headers,
          'If-Match': etag
        }
      }
    );

    return {
      ccId: existingId,
      action: 'updated',
      data: res.data
    };
  }

  // Priority 3: create a new product
  console.log(
    'CC PAYLOAD:',
    JSON.stringify(payload)
  );

  const res = await axios.post(
    CC_PRODUCTS,
    payload,
    { headers }
  );

  const ccId = getId(res.data);

  if (!ccId) {
    throw new Error(
      'CartonCloud product creation returned no ID. ' +
      'Check CartonCloud before retrying.'
    );
  }

  return {
    ccId,
    action: 'created',
    data: res.data
  };
}

// ── Warehouse product mapping ───────────────────────

function mapItemToWarehouse(item) {

console.log('\n========== CC WAREHOUSE INPUT ==========');
console.log('SKU:', item.sku);
console.log('Barcode:', item.barcode);
console.log('Piece Barcode:', item.pieceBarcode);
console.log('Stock Unit:', item.stockUnit);
console.log('Pieces Per Carton:', item.piecesPerCarton);

console.log('\nComplete item object:');
console.log(JSON.stringify(item, null, 2));
console.log('========================================\n');



  const uoms = {
    E: {
      name: item.stockUnit || 'Each',
      baseQty: 1,
      weight: item.weightKg || 0,
      barcode: item.barcode ? String(item.barcode) : undefined,
      isDecimal: false,
      isDirectlyShippable: false
    }
  };

  const CC_CASE_UOM_MAP = {
    CTN: 'CTN',
    CARTON: 'CTN',
    CS: 'CS',
    CASE: 'CS',
    BOX: 'BOX',
    PLT: 'PLT',
    PALLET: 'PLT'
  };

  const caseUnit = (
    item.purchaseUnit || ''
  ).toUpperCase();

  const caseKey = CC_CASE_UOM_MAP[caseUnit] || null;
  const caseQty = Number(item.piecesPerCarton || 0);

  if (caseKey && caseQty > 1) {
    uoms[caseKey] = {
      name: caseUnit,
      baseQty: caseQty,
      weight: (item.weightKg || 0) * caseQty,
      isDecimal: false,
      isDirectlyShippable: false
    };
  }

  return {
    references: {
      code: item.sku,
      barcode: item.barcode
        ? String(item.barcode)
        : undefined
    },
    name: item.displayName || item.sku,
    type: 'General',
    scope: 'WAREHOUSE',
    customer: {
      id: CC_CUSTOMER_ID
    },
    warehouses: CC_WAREHOUSE_ID
      ? [{ id: CC_WAREHOUSE_ID }]
      : [],
    defaultUnitOfMeasure: 'E',
    unitOfMeasures: uoms
  };
}


// ── Warehouse product lookup ────────────────────────

async function findWarehouseProductBySku(
  sku,
  headers
) {
  const res = await axios.get(CC_WAREHOUSE, {
    headers,
    params: { code: sku }
  });

  const items = getItems(res.data);

  return items.find(p => sameSku(p, sku)) || null;
}

async function upsertWarehouseProduct(item) {
  if (!item?.sku) {
    throw new Error('Missing SKU');
  }

  const headers = await authHeaders();
// DEBUG: inspect Excel item and CartonCloud mapping
console.log('\n===== WAREHOUSE DEBUG =====');

console.log('SKU:', item.sku);
console.log('Input barcode:', item.barcode);
console.log('Piece barcode:', item.pieceBarcode);

const debugPayload = mapItemToWarehouse(item);

console.log(
  'Mapped Each barcode:',
  debugPayload.unitOfMeasures.E.barcode
);

console.log('===========================\n');
  const existing = await findWarehouseProductBySku(
    item.sku,
    headers
  );

  // if (existing) {
  //   if (!existing.id) {
  //     throw new Error(
  //       'Existing warehouse product has no ID'
  //     );
  //   }

  //   return {
  //     ccWarehouseId: existing.id,
  //     action: 'exists'
  //   };
  // }

if (existing) {
  if (!existing.id) {
    throw new Error(
      'Existing warehouse product has no ID'
    );
  }

  // GET only: retrieve existing warehouse product
  const response = await axios.get(
    `${CC_WAREHOUSE}/${encodeURIComponent(existing.id)}`,
    { headers }
  );

  const detail = unwrapData(response.data);

  // Verify that we retrieved the correct SKU
  if (!sameSku(detail, item.sku)) {
    throw new Error(
      'Warehouse product ID does not match SKU ' +
      item.sku
    );
  }

  const expectedBarcode =
    String(item.barcode ?? '').trim();

  const actualBarcode =
    String(detail.unitOfMeasures?.E?.barcode ?? '').trim();

  let barcodeStatus;

  if (!expectedBarcode) {
    barcodeStatus = 'MISSING_EXCEL_BARCODE';
  } else if (!actualBarcode) {
    barcodeStatus = 'MISSING_CC_BARCODE';
  } else if (expectedBarcode === actualBarcode) {
    barcodeStatus = 'MATCH';
  } else {
    barcodeStatus = 'MISMATCH';
  }

  console.log('\n===== CC WAREHOUSE BARCODE CHECK =====');
  console.log('SKU:', item.sku);
  console.log('Excel Barcode:', expectedBarcode);
  console.log('CartonCloud Barcode:', actualBarcode);
  console.log('Barcode Status:', barcodeStatus);
  console.log('Action: NO UPDATE PERFORMED');
  console.log('======================================\n');

  return {
    ccWarehouseId: existing.id,
    action: 'exists',
    barcodeStatus,
    expectedBarcode,
    actualBarcode
  };
}



  const payload = mapItemToWarehouse(item);
console.log(
  'WAREHOUSE OUTPUT PAYLOAD:',
  JSON.stringify(payload, null, 2)
);
  const res = await axios.post(
    CC_WAREHOUSE,
    payload,
    { headers }
  );

  const ccWarehouseId = getId(res.data);

  if (!ccWarehouseId) {
    throw new Error(
      'Warehouse product creation returned no ID. ' +
      'Check CartonCloud before retrying.'
    );
  }

  return {
    ccWarehouseId,
    action: 'created'
  };
}

// ── Units of measure ─────────────────────────────────

const UOM_MAP = {
  '': 'E',
  EA: 'E',
  EACH: 'E',
  PCS: 'E',
  PC: 'E',
  UNIT: 'E'
};

function toCcUom(unit) {
  const normalized = String(unit || '')
    .trim()
    .toUpperCase();

  return UOM_MAP[normalized] || normalized || 'E';
}

// ── Purchase orders → inbound orders ────────────────

function mapPoToInbound(po) {
  const customerId =
    po.ccCustomerId || CC_CUSTOMER_ID;

  return {
    type: 'INBOUND',
    status: 'NOT_YET_RECEIVED',
    references: {
      customer: po.poNumber
    },
    customer: {
      id: customerId
    },
    details: {
      arrivalDate:
        fmtDate(po.shipDate) ||
        fmtDate(po.tranDate),
      instructions: po.memo || undefined
    },
    items: (po.lines || []).map(line => ({
      details: {
        product: {
          references: {
            code: line.sku
          }
        },
        unitOfMeasure: {
          type: toCcUom(line.units)
        }
      },
      measures: {
        quantity: Number(line.quantity)
      }
    }))
  };
}

// ── Search helpers for orders ────────────────────────

async function searchOrders(url, headers) {
  const res = await axios.post(
    `${url}/search`,
    {
      condition: {
        type: 'AndCondition',
        conditions: []
      }
    },
    { headers }
  );

  return getItems(res.data);
}

async function findInboundOrderByRef(
  poNumber,
  headers
) {
  const items = await searchOrders(
    CC_INBOUND,
    headers
  );

  return items.find(
    o => o.references?.customer === poNumber
  ) || null;
}

async function upsertInboundOrder(po) {
  const headers = await authHeaders();

  const existing = await findInboundOrderByRef(
    po.poNumber,
    headers
  );

  if (existing) {
    const numericId =
      existing.references?.numericId ??
      existing.ref?.numericId ??
      null;

    return {
      ccId: existing.id,
      ccNumericId: numericId,
      action: 'exists',
      poNumber: po.poNumber
    };
  }

  const payload = mapPoToInbound(po);

  const res = await axios.post(
    CC_INBOUND,
    payload,
    { headers }
  );

  const data = unwrapData(res.data);

  return {
    ccId: getId(res.data),
    ccNumericId:
      data?.references?.numericId ?? null,
    action: 'created',
    poNumber: po.poNumber
  };
}

// ── Sales orders → outbound orders ───────────────────

function mapSoToOutbound(so) {
  const customerId =
    so.ccCustomerId || CC_CUSTOMER_ID;

  return {
    type: 'OUTBOUND',
    references: {
      customer: so.soNumber
    },
    customer: {
      id: customerId
    },
    details: {
      instructions:
        so.packingInstructions || undefined,

      collect: {
        requiredDate:
          fmtDate(so.shipDate) ||
          fmtDate(so.tranDate)
      },

      deliver: {
        method: {
          type: 'SHIPPING'
        },
        address: so.ccDeliverAddressId
          ? { id: so.ccDeliverAddressId, companyName: so.customerName || '' }
          : undefined,
        requiredDate:
          fmtDate(so.shipDate) ||
          fmtDate(so.tranDate),
        instructions:
          so.deliveryInstructions || undefined
      }
    },
    items: (so.lines || []).map(line => ({
      details: {
        product: {
          references: {
            code: line.sku
          }
        },
        unitOfMeasure: {
          type: toCcUom(line.units)
        }
      },
      measures: {
        quantity: Number(line.quantity)
      }
    }))
  };
}

async function findOutboundOrderByRef(
  soNumber,
  headers
) {
  const items = await searchOrders(
    CC_OUTBOUND,
    headers
  );

  return items.find(
    o => o.references?.customer === soNumber
  ) || null;
}

async function upsertOutboundOrder(so) {
  const headers = await authHeaders();

  const existing = await findOutboundOrderByRef(
    so.soNumber,
    headers
  );

  if (existing) {
    const numericId =
      existing.references?.numericId ??
      existing.ref?.numericId ??
      null;

    return {
      ccId: existing.id,
      ccNumericId: numericId,
      action: 'exists',
      soNumber: so.soNumber
    };
  }

  const payload = mapSoToOutbound(so);

  const res = await axios.post(
    CC_OUTBOUND,
    payload,
    { headers }
  );

  const data = unwrapData(res.data);

  return {
    ccId: getId(res.data),
    ccNumericId:
      data?.references?.numericId ?? null,
    action: 'created',
    soNumber: so.soNumber
  };
}

// ── Fetch dispatched outbound orders ────────────────

async function getDispatchedOutboundOrders() {
  const headers = await authHeaders();

  const items = await searchOrders(
    CC_OUTBOUND,
    headers
  );

  return items.filter(o =>
    ['DISPATCHED', 'DELIVERED', 'COLLECTED']
      .includes(o.status)
  );
}

// ── Fetch verified inbound orders ────────────────────

async function getVerifiedInboundOrders() {
  const headers = await authHeaders();

  const items = await searchOrders(
    CC_INBOUND,
    headers
  );

  return items.filter(o =>
    ['VERIFIED', 'RECEIVED', 'ALLOCATED']
      .includes((o.status || '').toUpperCase())
  );
}

async function testFindProduct(sku) {
  const headers = await authHeaders();

  const res = await axios.get(CC_PRODUCTS, {
    headers,
    params: { sku }
  });

  console.log('RESPONSE HEADERS:', {
  link: res.headers.link,
  total: res.headers['x-total-count'],
  nextPage: res.headers['x-next-page']
});

  console.log('HTTP STATUS:', res.status);
  console.log('REQUESTED SKU:', sku);
  // console.log('API RESPONSE:', JSON.stringify(res.data, null, 2));
console.log('TOTAL RETURNED:', res.data.length);

console.log(
  'PRODUCT CODES:',
  res.data.map(p => ({
    id: p.id,
    code: p.references?.code || p.code
  }))
);
  const items = getItems(res.data);
  const product = items.find(p => sameSku(p, sku));

  console.log('MATCH FOUND:', Boolean(product));

  return product;
}

// ── CC warehouse stock per SKU ────────────────────────
async function getWarehouseStockBySku(skus) {
  if (!skus || !skus.length) return {};
  const headers = await authHeaders();
  const result  = {};
  await Promise.all(skus.map(async (sku) => {
    try {
      const res  = await axios.get(CC_WAREHOUSE, { headers, params: { code: sku } });
      const list = res.data?.data || res.data || [];
      const prod = Array.isArray(list) ? list.find(p => p.references?.code === sku) : null;
      result[sku] = prod
        ? (prod.quantityAvailable ?? prod.availableQuantity ?? prod.quantityOnHand ?? prod.quantity ?? null)
        : null;
    } catch { result[sku] = null; }
  }));
  return result;
}

// ── Exports ──────────────────────────────────────────

module.exports = {
  upsertProduct,
  upsertWarehouseProduct,
  upsertInboundOrder,
  upsertOutboundOrder,
  getDispatchedOutboundOrders,
  getVerifiedInboundOrders,
  getWarehouseStockBySku,
  testFindProduct
};
