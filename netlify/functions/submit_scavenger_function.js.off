// netlify/functions/submit_scavenger_function.js
const { ok, error, isPreflight, getSheets, tabRange, SHEET_ID } = require("./_utils.js");

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

function makeSubmissionId(teamCode, itemId) {
  const nonce = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `scavenger-${teamCode}-${itemId || "item"}-${nonce}`;
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return error(400, "Invalid JSON body"); }

    const {
      teamCode,
      teamName,          // optional
      itemId,            // your internal id per item (e.g. 1..6)
      itemTitle,         // the “name to find” shown to the player
      itemDescription,   // optional
      photoUrl,          // required
      maxPoints          // optional (defaults 15)
    } = body;

    if (!teamCode || !itemTitle || !photoUrl) {
      return error(400, "teamCode, itemTitle and photoUrl are required");
    }

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    // Make sure the canonical sheet exists
    await ensureSheetExists(
      sheets,
      spreadsheetId,
      "submissions",
      [
        "Timestamp",     // A
        "Team Code",     // B
        "Activity",      // C
        "Nonce",         // D
        "Payload",       // E (we'll store JSON: {itemId,itemTitle,itemDescription,photoUrl,maxPoints})
        "AI Status",     // F
        "AI Attempts",   // G
        "AI Score",      // H
        "Final Score",   // I (Zap writes this)
        "Idempotency",   // J (generated)
        "Event Id"       // K (optional)
      ]
    );

    const timestamp = new Date().toISOString();
    const payload = JSON.stringify({
      itemId: itemId ?? null,
      itemTitle,
      itemDescription: itemDescription ?? "",
      photoUrl,
      maxPoints: maxPoints ?? 15
    });

    const submissionId = makeSubmissionId(teamCode, itemId);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: tabRange("submissions", "A1"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          timestamp,       // Timestamp
          teamCode,        // Team Code
          "scavenger",     // Activity
          "",              // Nonce (unused here)
          payload,         // Payload JSON
          "QUEUED",        // AI Status (so the Zap triggers)
          "0",             // AI Attempts
          "",              // AI Score
          "",              // Final Score (Zap fills)
          submissionId,    // Idempotency
          ""               // Event Id (optional)
        ]]
      }
    });

    return ok({
      success: true,
      message: "Scavenger item submitted. AI will score shortly.",
      submissionId,
      teamCode,
      itemTitle
    });
  } catch (e) {
    console.error("submit_scavenger_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
