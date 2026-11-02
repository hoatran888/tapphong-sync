require('dotenv').config();
const { createItem } = require('../call-create-item');

(async () => {
  const result = await createItem(
{
  "sku": "TP-PAL-001",
  "displayName": "Test Pallet Product",
  "unitsTypeId": 6,
  "stockUnit": "PCS",
  "saleUnit": "PCS",
  "purchaseUnit": "PAL",
  "retailPrice": 10,
  "wholesalePrice": 8,
  "assetAccountId": 125,
  "cogsAccountId": 210,
  "incomeAccountId": 108
}
);
  console.log(result);
})();