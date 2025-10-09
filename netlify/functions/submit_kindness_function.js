// submit_kindness_function.js
// Writes a Kindness submission to the "submissions" sheet with photoUrl (Uploadcare),
// matching the scavenger flow so Zapier/AI can judge it.

const { ok, error, isPreflight, getSheets, SHEET_ID } = require("./_utils.js");

async function ensureSubmissionsSheet(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some(s => s.properties?.title === "submissions");
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: "submissions" } } }] }
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "submissions!A1",
      valueInputOption: "RAW",
      requestBody: { values: [[
        "Timestamp","Team Code","Activity","Nonce","Payload",
        "AI Status","AI Attempts","AI Score","Final Score","Idempotency","Event Id"
      ]] }
    });
  }
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return error(400, "Invalid JSON"); }

    const { eventId, teamCode, teamName, what, where, photoUrl } = body || {};
    if (!eventId) return error(400, "Missing eventId");
    if (!teamCode) return error(400, "Missing teamCode");
    if (!what || String(what).trim().length < 10) return error(400, "Description too short");
    if (!photoUrl) return error(400, "Missing photoUrl");

    const sheets = await getSheets();
    if (!sheets) return error(500, "Sheets client unavailable");
    await ensureSubmissionsSheet(sheets, SHEET_ID);

    const nowIso = new Date().toISOString();
    const idempotency = `kindness:${eventId}:${teamCode}:${nowIso}`;

    const payload = {
      activity: "kindness",
      text: String(what || ""),
      where: String(where || ""),
      teamName: String(teamName || ""),
      photoUrl: String(photoUrl || "")
    };

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "submissions!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          nowIso,              // Timestamp
          teamCode,            // Team Code
          "kindness",          // Activity
          "",                  // Nonce (unused)
          JSON.stringify(payload), // Payload (for Zapier/AI)
          "PENDING",           // AI Status
          "0",                 // AI Attempts
          "",                  // AI Score
          "",                  // Final Score
          idempotency,         // Idempotency key
          eventId              // Event Id
        ]]
      }
    });

    return ok({ success: true });
  } catch (e) {
    console.error("submit_kindness_function:", e);
    return error(500, e.message || "Unexpected error");
  }
};
