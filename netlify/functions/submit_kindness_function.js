// Submit a Kindness entry -> Google Sheets `submissions` tab
// Appends one row with a compact JSON payload; keeps AI columns for Zapier.

const { ok, error, isPreflight, getSheets, SHEET_ID } = require("./_utils.js");

const SHEET = "submissions";
const HEADERS = [
  "Timestamp",     // A
  "Team Code",     // B
  "Activity",      // C
  "Nonce",         // D
  "Payload",       // E (JSON string)
  "AI Status",     // F
  "AI Attempts",   // G
  "AI Score",      // H
  "Final Score",   // I
  "Idempotency",   // J
  "Event Id"       // K
];

async function ensureSheetWithHeader(sheets, spreadsheetId, title, headers) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some(s => s.properties?.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] }
    });
  }
  // Always ensure headers on row 1 (safe & idempotent)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${title}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers] }
  });
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return error(400, "Invalid JSON body"); }

    const {
      eventId,
      teamCode,
      teamName = "",
      what = "",
      where = "",
      photoBase64 = "" // optional; ignored to keep Sheets small
    } = body || {};

    if (!eventId || !teamCode) {
      return error(400, "Missing required fields: eventId and teamCode");
    }
    if (String(what).trim().length < 5) {
      return error(400, "Please add a short description of what happened.");
    }

    const sheets = await getSheets();
    if (!sheets) return error(500, "Spreadsheet client not available");
    const spreadsheetId = SHEET_ID;

    await ensureSheetWithHeader(sheets, spreadsheetId, SHEET, HEADERS);

    const nowIso = new Date().toISOString();

    // Compact payload used later by scoring/Gallery
    const payload = {
      activity: "kindness",
      text: String(what || ""),
      where: String(where || ""),
      teamName: String(teamName || ""),
      imageUrl: "",             // Zapier can upload + fill this later
      hasImage: !!photoBase64   // hint for automations
    };

    const idem =
      event.headers["idempotency-key"] ||
      event.headers["Idempotency-Key"] ||
      event.headers["IDEMPOTENCY-KEY"] ||
      `kindness:${eventId}:${teamCode}`;

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET}!A1`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          nowIso,                   // Timestamp
          teamCode,                 // Team Code
          "kindness",               // Activity
          "",                       // Nonce
          JSON.stringify(payload),  // Payload
          "PENDING",                // AI Status
          "0",                      // AI Attempts
          "",                       // AI Score
          "",                       // Final Score
          idem,                     // Idempotency
          eventId                   // Event Id
        ]]
      }
    });

    return ok({ success: true, message: "Kindness submitted." });
  } catch (e) {
    console.error("submit_kindness_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
