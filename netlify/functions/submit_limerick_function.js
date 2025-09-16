// netlify/functions/submit_limerick_function.js

const {
  ok, error, isPreflight,
  getSheets, tabRange, SHEET_ID
} = require("./_utils.js");

// Ensure the canonical "submissions" sheet exists with our standard columns
async function ensureSheetExists(sheets, spreadsheetId, title, headers) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some(s => s.properties?.title === title);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] }
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${title}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers] }
  });
}

const HEADERS = [
  "Timestamp",   // A
  "Team Code",   // B
  "Activity",    // C
  "Nonce",       // D
  "Payload",     // E
  "AI Status",   // F
  "AI Attempts", // G
  "AI Score",    // H
  "Final Score", // I
  "Idempotency", // J
  "Event Id"     // K
];

function randNonce(prefix = "limerick") {
  return `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    // ---- Parse & validate body ----
    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return error(400, "Invalid JSON body"); }

    const eventId      = String(body.eventId || "").trim();
    const teamCode     = String(body.teamCode || "").trim();
    const teamName     = String(body.teamName || "").trim(); // optional, stored in payload
    const topic        = String(body.topic || "").trim();
    const limerickRaw  = String(body.limerickText || "").trim();

    if (!teamCode || !limerickRaw) {
      return error(400, "teamCode and limerickText are required");
    }
    if (!eventId) {
      // We store Event Id in column K and your Zap filters on it, so require it
      return error(400, "eventId is required");
    }

    // Normalise & cap text length a bit (safety)
    const limerickText = limerickRaw.replace(/\r\n/g, "\n").slice(0, 2000);

    // Build payload JSON (matches Kindness layout: JSON string in E)
    const payload = JSON.stringify({
      activity: "limerick",
      topic,
      limerick: limerickText,
      teamName
    });

    // ---- Sheets client ----
    const sheets = await getSheets(); // throws if service account env missing
    const spreadsheetId = SHEET_ID;

    // Make sure the "submissions" sheet exists with expected headers
    await ensureSheetExists(sheets, spreadsheetId, "submissions", HEADERS);

    // ---- Row data (columns A–K) ----
    const timestamp    = new Date().toISOString();
    const nonce        = randNonce();                 // Column D
    const idempotency  = `limerick|${eventId}`;       // Column J (matches Kindness pattern)

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: tabRange("submissions", "A1"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          timestamp,          // A Timestamp
          teamCode,           // B Team Code
          "limerick",         // C Activity
          nonce,              // D Nonce
          payload,            // E Payload (JSON string)
          "QUEUED",           // F AI Status (same as Kindness)
          "0",                // G AI Attempts
          "",                 // H AI Score (blank - Zap/AI fills)
          "",                 // I Final Score (Zap fills)
          idempotency,        // J Idempotency
          eventId             // K Event Id
        ]]
      }
    });

    return ok({
      success: true,
      message: "Limerick submitted",
      nonce,
      idempotency,
      eventId
    });

  } catch (e) {
    console.error("submit_limerick_function error:", e);
    // Provide a clearer message when service account env vars are missing
    const msg = /invalid_grant|unauthorized_client|JWT|private key|credentials/i.test(String(e && e.message))
      ? "Missing Google service account (set GOOGLE_SERVICE_ACCOUNT_JSON[_B64] or EMAIL/PRIVATE_KEY)"
      : (e && e.message) || "Unexpected error";
    return error(500, msg);
  }
};
