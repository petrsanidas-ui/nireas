# Google Sheet → vehicles.json sync

Use the script below to pull the municipality vehicles list from a Google Sheet and update
`data/resources/vehicles.json` automatically.

## Prerequisites
- The sheet can be **public** (read-only) or you can provide a **Google Sheets API key**.
- Columns should match the sheet headers:
  `municipality_id, S/N, Registration Number, Brand, Model, Type, Category, Fuel, Parking, Department, License Category, Special Category, Status`.

## Run (public sheet)
```bash
python scripts/sync_vehicles_from_sheet.py \
  --sheet-id 1EkTVFr6r5cGSAfHzC2wlhl2PAmfrG4G6sqGgEJSgbU8 \
  --default-municipality-id chalandri
```

## Run (with API key)
```bash
export GOOGLE_SHEETS_API_KEY="YOUR_KEY"
python scripts/sync_vehicles_from_sheet.py \
  --sheet-id 1EkTVFr6r5cGSAfHzC2wlhl2PAmfrG4G6sqGgEJSgbU8 \
  --sheet-name Sheet1 \
  --default-municipality-id chalandri
```

## Notes
- `Status` values are normalized to known UI states (`available`, `assigned`, `unavailable`).
- `Special Category` is copied into the `notes` field in `vehicles.json`.

## Optional: Webhook + Apps Script (automatic sync)
If you want **automatic** updates when the Google Sheet changes, you can trigger a webhook.

### 1) Run a webhook server (on your Nireas host)
```bash
export SHEET_ID="1EkTVFr6r5cGSAfHzC2wlhl2PAmfrG4G6sqGgEJSgbU8"
export DEFAULT_MUNICIPALITY_ID="chalandri"
export WEBHOOK_SECRET="change-me"
python scripts/vehicles_webhook_server.py
```

The server listens on `http://<host>:8787/vehicles/sync` and runs the sync script.

### 2) Apps Script (attach to the Sheet)
Create a Google Apps Script in the Sheet and paste:
```js
function onEdit(e) {
  var url = "https://YOUR_HOST/vehicles/sync";
  var payload = JSON.stringify({ source: "sheet" });
  var options = {
    method: "post",
    contentType: "application/json",
    payload: payload,
    headers: { "X-Webhook-Token": "change-me" }
  };
  UrlFetchApp.fetch(url, options);
}
```

Replace `YOUR_HOST` and the token with the values you set on the server.
