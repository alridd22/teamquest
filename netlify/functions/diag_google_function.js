// netlify/functions/diag_google_function.js
const { ok, error, isPreflight, SHEET_ID, getSheets } = require("./_utils");
const fs = require("node:fs");
const path = require("node:path");

exports.handler = async (event) => {
  // CORS preflight
  if (isPreflight(event)) return ok({ ok: true });

  try {
    // Inspect the JSON key written at build time
    const keyPath = path.join(__dirname, "sa_key.json");
    let client_email = null;
    let keyfile_present = false;

    try {
      const txt = fs.readFileSync(keyPath, "utf8");
      keyfile_present = !!txt;
      const obj = JSON.parse(txt);
      client_email = obj.client_email || null;
    } catch {
      // ignore; we'll still try auth via getSheets()
    }

    // Auth via JSON keyfile and make a cheap read
    const sheets = await getSheets(); // uses GoogleAuth({ keyFile: 'sa_key.json' })
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "A1:A1", // adjust if you prefer a different quick probe range
    });

    return ok({
      success: true,
      source: "file:sa_key.json",
      keyfile_present,
      sheet_id_present: !!SHEET_ID,
      client_email_present: !!client_email,
      client_email,
      values_preview: res.data.values || [],
    });
  } catch (e) {
    return error(500, "diag failed", {
      source: "file:sa_key.json",
      sheet_id_present: !!SHEET_ID,
      message: String(e && e.message || e),
      stack: e && e.stack,
    });
  }
};
