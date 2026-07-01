// Google Apps Script backend for MedicineCabinet.
//
// Required Script Properties (Project Settings -> Script Properties):
//   SHEET_ID       the target spreadsheet's ID (from its URL)
//   SHEET_NAME     (optional) worksheet tab name, defaults to "medicines"
//
// Deploy: Deploy -> New deployment -> Web app
//   Execute as:      Me
//   Who has access:  Anyone
// The /exec URL is your shared secret — don't commit it to a public repo.

const HEADERS = [
  "id", "name", "type", "strength", "dosage",
  "quantity", "condition", "description", "purchaseDate", "expiryDate",
];

function doGet(e) {
  return handle_(function () {
    var action = (e && e.parameter && e.parameter.action) || "list";
    if (action === "list") return { medicines: readAll_() };
    throw new Error("Unknown action: " + action);
  });
}

function doPost(e) {
  return handle_(function () {
    var body = JSON.parse(e.postData.contents || "{}");
    if (body.action === "replace") {
      replaceAll_(body.medicines || []);
      return { ok: true, count: body.medicines.length };
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

function readAll_() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  return values
    .filter(function (row) { return String(row[0] || "").length > 0; })
    .map(function (row) {
      var obj = {};
      for (var i = 0; i < HEADERS.length; i++) obj[HEADERS[i]] = row[i] === "" ? "" : String(row[i]);
      return obj;
    });
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
