# NetSuite — How to Find Your RESTlet Script

*Date: 2026-10-20*

---

## Why you can't find rl_create_item.js

The Scripts listing shows the **script name** you gave it when creating the record — not the filename. It may be listed as something like `"Tapphong Item Sync"` or `"Create Item"`.

---

## Tips to find it

**1. Filter by RESTlet type:**
```
Customization → Scripting → Scripts
→ set Type filter to "RESTlet" → search
```

**2. Search via File Cabinet:**
```
Documents → Files → File Cabinet → SuiteScripts
```
Find `rl_create_item.js` → click it → it links to the script record.

**3. Go directly by Script ID:**

If `NS_SCRIPT_ID=1942` is already in your `.env`, find it by internal ID:
```
Customization → Scripting → Scripts
→ look for Internal ID = 1942
```
Enable **Show Internal IDs** first if the ID column is not visible:
```
Home → Set Preferences → General → check Show Internal IDs
```
