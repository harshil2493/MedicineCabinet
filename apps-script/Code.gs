// Google Apps Script backend for MedicineCabinet.
//
// Required Script Properties (Project Settings -> Script Properties):
//   SHEET_ID         the target spreadsheet's ID (from its URL)
//   APP_PASSWORD     the shared password the frontend must send
//   GEMINI_API_KEY   (optional) Google AI Studio API key for AI lookup
//   SHEET_NAME       (optional) worksheet tab name, defaults to "medicines"
//
// Deploy: Deploy -> New deployment -> Web app
//   Execute as:      Me
//   Who has access:  Anyone
// The APP_PASSWORD is what actually gates access. Every action goes through
// POST so the password stays out of URLs / server logs.

// purchaseDate kept in HEADERS for backward compat with sheets that already have that
// column. The frontend no longer writes/reads it — it just stays empty on new rows.
// volumeMl appended at the end so adding it doesn't shift existing columns.
const HEADERS = [
  "id", "name", "type", "strength", "dosage",
  "quantity", "condition", "description", "purchaseDate", "expiryDate",
  "volumeMl",
];

const SETTINGS_TAB = "settings";
const SETTINGS_HEADERS = ["key", "value"];
const DEFAULT_SETTINGS = { expiryDays: 60, lowPill: 10, lowLiquid: 2 };

function doGet(e) {
  return json_({ error: "Use POST" });
}

function doPost(e) {
  return handle_(function () {
    var body = JSON.parse(e.postData.contents || "{}");
    assertPassword_(body.password);
    if (body.action === "list") return { medicines: readAll_() };
    if (body.action === "replace") {
      replaceAll_(body.medicines || []);
      return { ok: true, count: body.medicines.length };
    }
    if (body.action === "lookup") {
      return lookup_(body.name, body.strength);
    }
    if (body.action === "get_settings") {
      return { settings: readSettings_() };
    }
    if (body.action === "save_settings") {
      writeSettings_(body.settings || {});
      return { ok: true };
    }
    throw new Error("Unknown action: " + body.action);
  });
}

function handle_(fn) {
  try {
    return json_(fn());
  } catch (err) {
    return json_({ error: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function assertPassword_(supplied) {
  var expected = PropertiesService.getScriptProperties().getProperty("APP_PASSWORD");
  if (!expected) throw new Error("Server not configured: APP_PASSWORD missing");
  if (!supplied || supplied !== expected) throw new Error("Unauthorized");
}

function sheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("SHEET_ID");
  if (!id) throw new Error("Server not configured: SHEET_ID missing");
  var tab = props.getProperty("SHEET_NAME") || "medicines";
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName(tab);
  if (!sh) sh = ss.insertSheet(tab);
  ensureHeaders_(sh);
  return sh;
}

function ensureHeaders_(sh) {
  var firstRow = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  var needs = false;
  for (var i = 0; i < HEADERS.length; i++) {
    if (firstRow[i] !== HEADERS[i]) { needs = true; break; }
  }
  if (needs) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
  }
}

function cellToStr_(v) {
  if (v === "" || v == null) return "";
  if (Object.prototype.toString.call(v) === "[object Date]") {
    var y = v.getFullYear();
    var m = String(v.getMonth() + 1);
    if (m.length < 2) m = "0" + m;
    var d = String(v.getDate());
    if (d.length < 2) d = "0" + d;
    return y + "-" + m + "-" + d;
  }
  return String(v);
}

function readAll_() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  return values
    .filter(function (row) { return String(row[0] || "").length > 0; })
    .map(function (row) {
      var obj = {};
      for (var i = 0; i < HEADERS.length; i++) obj[HEADERS[i]] = cellToStr_(row[i]);
      return obj;
    });
}

// One-time helper: select this in the editor's function dropdown and click Run.
// Triggers the OAuth prompt for the UrlFetchApp scope needed by lookup_.
function authorizeExternalRequest() {
  UrlFetchApp.fetch("https://httpbin.org/get");
  Logger.log("External request scope authorized.");
}

function lookup_(name, strength) {
  var key = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY not set — add it in Script Properties");
  if (!name) throw new Error("name required");

  var prompt =
    'For the medicine "' + name + '"' +
    (strength ? ' (' + strength + ')' : '') +
    ', return JSON with exactly six fields:\n' +
    '- "type": one of "drug", "liquid_oral", "injection", "eye_drops", "ear_drops". Pick "drug" for tablets/capsules/pills.\n' +
    '- "strength": most common strength/concentration if inferable from the name (e.g. "500 mg", "5 mg/mL"). Empty string if already in the name or unknown.\n' +
    '- "dosage": typical adult dosage with timing/frequency (e.g. "1 tablet twice daily, after meals" or "10 ml at bedtime"). Use plain English. If dosage varies widely, give the most common adult regimen.\n' +
    '- "volumeMl": typical bottle/vial volume in mL as a plain number string (e.g. "10", "60"). Only for non-drug types. Return empty string for "drug" or if unknown.\n' +
    '- "condition": short phrase (under 6 words) for what it is commonly used for (e.g. "Fever and mild pain" or "Bacterial infection")\n' +
    '- "description": 2-3 plain-language sentences on what it is, how it works, and general precautions.\n' +
    'If you don\'t recognize the name, return type as "drug" and all other fields as empty strings.';

  var url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
    encodeURIComponent(key);

  var payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          type: { type: "STRING", enum: ["drug", "liquid_oral", "injection", "eye_drops", "ear_drops"] },
          strength: { type: "STRING" },
          dosage: { type: "STRING" },
          volumeMl: { type: "STRING" },
          condition: { type: "STRING" },
          description: { type: "STRING" },
        },
        required: ["type", "strength", "dosage", "volumeMl", "condition", "description"],
      },
    },
  };

  var resp = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  var raw = resp.getContentText();
  var code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("Gemini " + code + ": " + raw.slice(0, 200));
  }
  var data = JSON.parse(raw);
  var text = ((data.candidates || [])[0]?.content?.parts || [])
    .map(function (p) { return p.text || ""; })
    .join("");
  if (!text) return { type: "drug", strength: "", dosage: "", volumeMl: "", condition: "", description: "" };
  return JSON.parse(text);
}

function settingsSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("SHEET_ID");
  if (!id) throw new Error("Server not configured: SHEET_ID missing");
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName(SETTINGS_TAB);
  if (!sh) sh = ss.insertSheet(SETTINGS_TAB);
  var firstRow = sh.getRange(1, 1, 1, SETTINGS_HEADERS.length).getValues()[0];
  if (firstRow[0] !== SETTINGS_HEADERS[0] || firstRow[1] !== SETTINGS_HEADERS[1]) {
    sh.getRange(1, 1, 1, SETTINGS_HEADERS.length).setValues([SETTINGS_HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readSettings_() {
  var sh = settingsSheet_();
  var last = sh.getLastRow();
  var out = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) { out[k] = DEFAULT_SETTINGS[k]; });
  if (last < 2) return out;
  var rows = sh.getRange(2, 1, last - 1, SETTINGS_HEADERS.length).getValues();
  rows.forEach(function (r) {
    var k = String(r[0] || "").trim();
    if (!k) return;
    var v = r[1];
    if (typeof DEFAULT_SETTINGS[k] === "number") {
      var n = Number(v);
      if (!isNaN(n)) out[k] = n;
    } else {
      out[k] = v;
    }
  });
  return out;
}

function writeSettings_(patch) {
  var current = readSettings_();
  Object.keys(patch).forEach(function (k) {
    if (k in DEFAULT_SETTINGS) current[k] = patch[k];
  });
  var sh = settingsSheet_();
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, SETTINGS_HEADERS.length).clearContent();
  var rows = Object.keys(current).map(function (k) { return [k, current[k]]; });
  if (rows.length) sh.getRange(2, 1, rows.length, SETTINGS_HEADERS.length).setValues(rows);
}

function replaceAll_(medicines) {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, HEADERS.length).clearContent();
  if (!medicines.length) return;
  var rows = medicines.map(function (m) {
    return HEADERS.map(function (h) { return m[h] == null ? "" : m[h]; });
  });
  sh.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
}
