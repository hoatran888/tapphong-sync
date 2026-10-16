# NetSuite Accounting Fields — assetAccountId, incomeAccountId, cogsAccountId

These are the three accounting accounts NetSuite requires on every Inventory Item to post financial transactions correctly.

---

## `assetAccountId` — Inventory Asset Account

- **What it is:** The balance sheet account that holds the value of your physical inventory
- **Example:** `Inventory Asset` or `Stock on Hand`
- **When used:** Every time inventory is received or adjusted — NetSuite debits this account
- **Required:** Yes for inventory items

---

## `incomeAccountId` — Sales Income Account

- **What it is:** The P&L account that records revenue when the item is sold
- **Example:** `Sales Revenue` or `Product Sales`
- **When used:** When a Sales Order is fulfilled and invoiced — NetSuite credits this account
- **Required:** Yes for inventory items

---

## `cogsAccountId` — Cost of Goods Sold Account

- **What it is:** The P&L account that records the cost of inventory when sold
- **Example:** `Cost of Goods Sold` or `COGS`
- **When used:** When a sale is invoiced — NetSuite debits this account to match the cost against the revenue
- **Required:** Yes for inventory items

---

## Simple flow showing all three

```
Buy stock:
  DR  Inventory Asset      $100   ← assetAccountId
  CR  Accounts Payable     $100

Sell stock for $150:
  DR  Accounts Receivable  $150
  CR  Sales Revenue        $150   ← incomeAccountId

  DR  Cost of Goods Sold   $100   ← cogsAccountId
  CR  Inventory Asset      $100   ← assetAccountId
```

---

## Where to find the real IDs in NetSuite

1. Go to **Setup → Accounting → Chart of Accounts**
2. Hover over an account name
3. The URL shows `id=XXXX` — use that number in your Excel file

---

## In the Excel file (TP-Info.xlsx)

| Column | Field | Example real NS internal ID |
|---|---|---|
| `assetAccountId` | Inventory Asset account | e.g. `312` |
| `incomeAccountId` | Sales Revenue account | e.g. `401` |
| `cogsAccountId` | Cost of Goods Sold account | e.g. `502` |

Replace the placeholder values (123, 456, 789) with real IDs from your Chart of Accounts.

---

*Generated: 2026-10-15*
