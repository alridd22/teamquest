// submit_kindness_function.js
// Writes a Kindness submission to the "submissions" sheet with photoUrl (Uploadcare),
// now including Nonce + stable identifiers for Zapier/AI lookups.

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

function makeNonce(n=6){
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s=""; for (let i=0;i<n;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
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
      what, where, photoUrl,
      activity, timestamp, submissionId, nonce, idempotency
    } = body || {};

    if (!eventId)  return error(400, "Missing eventId");
    if (!teamCode) return error(400, "Missing teamCode");
    if (!what || String(what).trim().length < 1) return error(400, "Description too short");
    if (!photoUrl) return error(400, "Missing photoUrl");

    // Normalise identifiers (fallbacks keep older clients working)
    const nowIso = new Date().toISOString();
    const ts   = (timestamp && String(timestamp)) || nowIso;
    const act  = (activity && String(activity)) || "kindness";
    const subId= (submissionId && String(submissionId)) || "";
    const nn   = (nonce && String(nonce)) || makeNonce();
    const idem = (idempotency && String(idempotency)) || `${act}|${eventId}|${teamCode}|${ts}`;

    const sheets = await getSheets();
    if (!sheets) return error(500, "Sheets client unavailable");
    await ensureSubmissionsSheet(sheets, SHEET_ID);

    const payload = {
      activity: act,
      text: String(what || ""),
      where: String(where || ""),
      teamName: String(teamName || ""),
      photoUrl: String(photoUrl || ""),
      submissionId: subId || undefined // include if you want to read later
    };

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "submissions!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          ts,                 // Timestamp
          teamCode,           // Team Code
          act,                // Activity
          nn,                 // Nonce  ✅ now filled
          JSON.stringify(payload), // Payload (for Zapier/AI)
          "PENDING",          // AI Status
          "0",                // AI Attempts
          "",                 // AI Score
          "",                 // Final Score
          idem,               // Idempotency key (for debugging)
          eventId             // Event Id
        ]]
      }
    });

    return ok({ success: true, nonce: nn, idempotency: idem, timestamp: ts });
  } catch (e) {
    console.error("submit_kindness_function:", e);
    return error(500, e.message || "Unexpected error");
  }
};
