# The Cabinet

A personal medicine-cabinet tracker. Data lives in a Google Sheet you own — the app is a friendlier UI on top of it. Access is gated by a password you pick.

## Setup (once, ~5 minutes)

### 1. Google Sheet
Create a new Google Sheet. Copy its ID from the URL (`.../spreadsheets/d/<THIS_PART>/edit`).

### 2. Apps Script backend
- In the sheet: **Extensions → Apps Script**.
- Replace the default `Code.gs` with the contents of [`apps-script/Code.gs`](apps-script/Code.gs).
- **Project Settings ⚙️ → Script Properties → Add script property**:
  - `SHEET_ID` — the ID from step 1
  - `APP_PASSWORD` — a password you invent (10+ chars, avoid quotes)
  - `SHEET_NAME` — optional, defaults to `medicines`
- **Deploy → New deployment → gear icon → Web app**
  - Execute as: **Me**
  - Who has access: **Anyone**
- Authorize when prompted. Copy the deployment URL (ends in `/exec`).

> The `APP_PASSWORD` is what gates access. The `/exec` URL will be public once deployed (it's baked into the JS bundle) — the password is what stops random visitors.

### 3. Local env
```
cp .env.example .env
```
Fill in `VITE_APPS_SCRIPT_URL` with the URL from step 2.

### 4. Run locally
```
npm install
npm run dev
```
Open http://localhost:9999. Enter your `APP_PASSWORD`. Add a medicine, then check that a row appears in the Sheet.

## Deploy to GitHub Pages

1. **Repo settings → Pages → Build and deployment → Source**: **GitHub Actions**.
2. **Repo settings → Secrets and variables → Actions → New repository secret**:
   - Name: `VITE_APPS_SCRIPT_URL`
   - Value: the same `/exec` URL you put in `.env`
3. Push to `main`. The `.github/workflows/deploy.yml` workflow builds and publishes to `https://<your-user>.github.io/MedicineCabinet/`.
4. Visit the URL, enter your `APP_PASSWORD` — same session-storage prompt as local.

To rotate the password: update `APP_PASSWORD` in Apps Script Script Properties → redeploy the Apps Script (Deploy → Manage deployments → New version). Everyone's session dies; they'll re-prompt.

## Using it from your phone (local dev)

```
npm run dev -- --host
```
Then open `http://<your-laptop-ip>:9999` on your phone (same wifi). Or just use the deployed GitHub Pages URL — that works from anywhere.

## How it works

- **Frontend**: Vite + React. `src/MedicineCabinet.jsx` is the UI, wrapped in `src/PasswordGate.jsx`.
- **Storage**: `src/storage.js` mimics a simple KV interface; under the hood it POSTs the full medicine list to the Apps Script whenever anything changes.
- **Backend**: `apps-script/Code.gs` — one POST endpoint dispatching on `action` (`list`, `replace`), password-checked on every call.
- **Password**: kept in `sessionStorage` (dies with tab close). Sent in the POST body, never in URLs.

## Non-goals

- The "Suggest what it's for" button is stubbed. Wire it later by proxying Gemini (free tier) or Anthropic through the Apps Script.
- Whole-array replace on every save. If the sheet grows to hundreds of rows, switch to per-row upsert.
- No per-user accounts — single shared password. Personal-scale only.

# MedicineCabinet
