# Apps Script backend

## Deploy

1. Open your Sheet → **Extensions → Apps Script**.
2. Delete the boilerplate `function myFunction() {}` and paste `Code.gs`.
3. **Project Settings ⚙️ → Script Properties → Add script property**:
   | Key | Value |
   | --- | --- |
   | `SHEET_ID` | ID from the sheet URL |
   | `SHEET_NAME` | (optional) tab name, defaults to `medicines` |
4. **Deploy → New deployment → gear icon → Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy**. Authorize when prompted (the script needs to read/write your Sheet). Copy the `/exec` URL — that's `VITE_APPS_SCRIPT_URL`.

## Redeploy after edits

Apps Script pins each deployment to a code version. After edits: **Deploy → Manage deployments → pencil icon → Version: New version → Deploy**. The URL stays the same.

## Test from a terminal

```sh
URL="https://script.google.com/macros/s/.../exec"
curl -s "$URL?action=list"
```

Expected: `{"medicines":[]}` (or your rows).

## Troubleshooting

- **`Server not configured: SHEET_ID missing`** — Script Properties aren't set. Reopen Project Settings.
- **HTML response instead of JSON** — Deployment access probably isn't set to *"Anyone"*, or you didn't redeploy after code changes.
- **Rows appear blank** — check row 1 has the headers (`id`, `name`, …). The script writes them automatically on first request.
