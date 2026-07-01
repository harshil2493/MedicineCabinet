# The Cabinet

A personal medicine-cabinet tracker. Data lives in a Google Sheet you own — the app is a friendlier UI on top of it.

## Setup (once, ~5 minutes)

### 1. Google Sheet
Create a new Google Sheet. Copy its ID from the URL (`.../spreadsheets/d/<THIS_PART>/edit`).

### 2. Apps Script backend
- In the sheet: **Extensions → Apps Script**.
- Replace the default `Code.gs` with the contents of [`apps-script/Code.gs`](apps-script/Code.gs).
- **Project Settings ⚙️ → Script Properties → Add script property**:
  - `SHEET_ID` — the ID from step 1
  - `SHEET_NAME` — optional, defaults to `medicines`
- **Deploy → New deployment → gear icon → Web app**
  - Execute as: **Me**
  - Who has access: **Anyone**
- Authorize when prompted. Copy the deployment URL (ends in `/exec`).

> The `/exec` URL is your shared secret. Don't paste it into a public repo, chat log, or screenshot.

### 3. Local env
```
cp .env.example .env
```
Fill in `VITE_APPS_SCRIPT_URL` with the URL from step 2.

### 4. Run
```
npm install
npm run dev
```
Open http://localhost:9999. Add a medicine, then check that a row appears in the Sheet.

## Using it from your phone

```
npm run dev -- --host
```
Then open `http://<your-laptop-ip>:9999` on your phone (same wifi). Your laptop has to be awake and running the dev server.

## How it works

- **Frontend**: Vite + React. `src/MedicineCabinet.jsx` is the UI.
- **Storage**: `src/storage.js` mimics a simple KV interface; under the hood it POSTs the full medicine list to the Apps Script whenever anything changes.
- **Backend**: `apps-script/Code.gs` — two actions (`list`, `replace`) that read/write rows in the sheet.

## Non-goals

- The "Suggest what it's for" button is stubbed. Wire it later by proxying Gemini (free tier) or Anthropic through the Apps Script.
- No authentication — anyone with the `/exec` URL can read/write. Fine for a personal app where the URL stays private.
- Whole-array replace on every save. If the sheet grows to hundreds of rows, switch to per-row upsert.
# MedicineCabinet
