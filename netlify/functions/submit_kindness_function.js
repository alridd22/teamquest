// submit_kindness_function.js
const { ok, error, isPreflight, getSheets, SHEET_ID } = require("./_utils.js");

async function ensureSheetWithHeader(sheets, spreadsheetId, title, headers) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some(s => s.properties?.title === title);
  if (!exists) {
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
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return error(400, "Invalid JSON"); }

    const {
      eventId, teamCode, teamName,
      what, where,
      photoBase64 = "", photoMime = "", photoFileName = "", photoSize = 0, photoWasTruncated = 0
    } = body || {};

    if (!eventId) return error(400, "Missing eventId");
    if (!teamCode) return error(400, "Missing teamCode");
    if (!what || String(what).trim().length < 10) return error(400, "Please add a short description (10+ chars).");

    const sheets = await getSheets();
    if (!sheets) return error(500, "Spreadsheet client not available");
    const spreadsheetId = SHEET_ID;

    await ensureSheetWithHeader(
      sheets, spreadsheetId, "submissions",
      [
        "Timestamp","Team Code","Activity","Nonce","Payload",
        "AI Status","AI Attempts","AI Score","Final Score","Idempotency","Event Id"
      ]
    );

    const nowIso = new Date().toISOString();
    const idempotency = `kindness:${eventId}:${teamCode}:${nowIso}`;

    // Build a compact payload for Sheets cell size limits
    const payload = {
      activity: "kindness",
      text: String(what || ""),
      where: String(where || ""),
      teamName: String(teamName || ""),
      // keep image block compact; Zapier/AI can consume base64 if present
      photo: photoBase64 ? {
        base64: String(photoBase64),
        mime: String(photoMime || ""),
        fileName: String(photoFileName || ""),
        size: Number(photoSize || 0) || 0,
        truncated: !!photoWasTruncated
      } : null
    };

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "submissions!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          nowIso,                  // Timestamp
          teamCode,                // Team Code
          "kindness",              // Activity
          "",                      // Nonce
          JSON.stringify(payload), // Payload
          "PENDING",               // AI Status
          "0",                     // AI Attempts
          "",                      // AI Score
          "",                      // Final Score (admin/manual/AI later)
          idempotency,             // Idempotency
          eventId || ""            // Event Id
        ]]
      }
    });

    return ok({ success: true, message: "Kindness submission recorded" });

  } catch (e) {
    console.error("submit_kindness_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
