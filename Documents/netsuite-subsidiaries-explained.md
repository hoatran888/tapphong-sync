# NetSuite Subsidiaries — What They Are and Why They Matter

## What is a Subsidiary?

In NetSuite, a **Subsidiary** is a separate legal entity or business unit within your company group.

### Simple example

```
Parent Company: Tap Phong Group
    ├── Tap Phong Trading Co.        ← Subsidiary 1 (Vietnam)
    ├── Tap Phong Australia Pty Ltd  ← Subsidiary 2 (Australia)
    └── Tap Phong USA Inc.           ← Subsidiary 3 (USA)
```

Each subsidiary:
- Has its own Chart of Accounts
- Has its own financial reports (P&L, Balance Sheet)
- Can have its own currency
- Files its own tax returns

---

## Why it matters for account IDs

When you create an account in NetSuite OneWorld (multi-subsidiary), you can restrict it to specific subsidiaries. For example:

- Account `209 - Product Costs` might only be assigned to **Tap Phong Trading Co.**
- If you try to use it for an item that belongs to a **different subsidiary**, NetSuite rejects it with:
  ```
  Invalid Field Value 209 for the following field: cogsaccount
  ```

---

## How to check subsidiary restrictions on an account

1. Go to **Setup → Accounting → Chart of Accounts**
2. Click **Edit** on the account (e.g. account 209)
3. Look for:

| Field | What to look for |
|---|---|
| **Subsidiary** | Which subsidiary this account belongs to |
| **Restrict to subsidiaries** | If checked, only that subsidiary can use it |

---

## Fix options

| Option | How |
|---|---|
| Remove restriction | Edit the account → uncheck subsidiary restriction |
| Use correct account | Pick an account that belongs to the correct subsidiary |
| Skip account fields | Set `assetAccountId`, `incomeAccountId`, `cogsAccountId` to `0` in Excel — NS uses defaults |

---

## Tap Phong subsidiaries (from NS)

```
Parent Company : Tap Phong Trading Co.
```

---

*Generated: 2026-10-15*
