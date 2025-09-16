// netlify/functions/submit_limerick_function.js
const {
  ok, error, isPreflight,
  getSheets, tabRange, SHEET_ID
} = require("./_utils.js");

// Optional self-heal: create "submissions" tab with expected headers if missing
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

function makeSubmissionId(teamCode) {
  const nonce = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `limerick-${teamCode}-${nonce}`;
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return error(400, "Invalid JSON body"); }

    const teamCode = String(body.teamCode || "").trim();
    const teamName = String(body.teamName || "").trim(); // optional in sheet
    const topic = String(body.topic || "").trim();
    const limerickText = String(body.limerickText || "").trim();

    if (!teamCode || !limerickText) {
      return error(400, "teamCode and limerickText are required");
    }

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    // Ensure canonical "submissions" tab exists with your header layout
    await ensureSheetExists(
      sheets,
      spreadsheetId,
      "submissions",
      [
        "Timestamp",     // A
        "Team Code",     // B
        "Activity",      // C
        "Nonce",         // D
        "Payload",       // E (we store the poem text here)
        "AI Status",     // F
        "AI Attempts",   // G
        "AI Score",      // H
        "Final Score",   // I (Zap writes this)
        "Idempotency",   // J (we generate)
        "Event Id"       // K (optional)
      ]
    );

    const timestamp = new Date().toISOString();
    const nonce = Math.random().toString(36).slice(2, 8).toUpperCase();
    const submissionId = makeSubmissionId(teamCode);

    // Append a single row to "submissions"
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: tabRange("submissions", "A1"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          timestamp,          // Timestamp
          teamCode,           // Team Code
          "limerick",         // Activity
          nonce,              // Nonce
          limerickText,       // Payload (poem)
          "PENDING",          // AI Status (placeholder if you add AI later)
          "0",                // AI Attempts
          "",                 // AI Score
          "",                 // Final Score (Zap fills)
          submissionId,       // Idempotency
          ""                  // Event Id (optional)
        ]]
      }
    });

    // Return submissionId so Zapier (or the UI) can reference it later
    return ok({
      success: true,
      message: "Limerick submitted!",
      submissionId,
      teamCode,
      teamName,
      topic
    });
  } catch (e) {
    console.error("submit_limerick_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
