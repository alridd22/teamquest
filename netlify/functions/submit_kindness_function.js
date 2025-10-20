// submit_kindness_function.js
// Writes a Kindness submission to the "submissions" sheet and notifies Zapier
// so your webhook-triggered Kindness Scoring Zap runs immediately.

const { ok, error, isPreflight, getSheets, SHEET_ID } = require("./_utils.js");

// Ensure the "submissions" sheet exists with expected headers
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
        "AI Status","AI Attempts","AI Score","Final Score","Idempotency","Event Id",
        "Last Attempt At","Zap Error"
      ]] }
    });
  }
}

// Short, readable nonce
function makeNonce(n = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = ""; for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    // ---- Parse body ----
    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return error(400, "Invalid JSON"); }

    const {
      eventId, teamCode, teamName,
      what, where, photoUrl,
      activity, timestamp, submissionId, nonce, idempotency
    } = body || {};

    // ---- Validation ----
    if (!eventId)  return error(400, "Missing eventId");
    if (!teamCode) return error(400, "Missing teamCode");
    // Description character limit removed by request
    if (!photoUrl) return error(400, "Missing photoUrl"); // make optional by commenting this line

    // ---- Normalize identifiers ----
    const nowIso = new Date().toISOString();
    const ts    = (timestamp && String(timestamp)) || nowIso;
    const act   = (activity && String(activity)) || "kindness";
    const subId = (submissionId && String(submissionId)) || "";
    const nn    = (nonce && String(nonce)) || makeNonce();
    const idem  = (idempotency && String(idempotency)) || `${act}|${eventId}|${teamCode}|${ts}`;

    // ---- Build payload for the "Payload" column ----
    const payload = {
      activity: act,
      text: String(what || ""),
      where: String(where || ""),
      teamName: String(teamName || ""),
      photoUrl: String(photoUrl || ""),
      submissionId: subId || undefined
    };

    // ---- Write to Google Sheets ----
    const sheets = await getSheets();
    if (!sheets) return error(500, "Sheets client unavailable");
    await ensureSubmissionsSheet(sheets, SHEET_ID);

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "submissions!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          ts,                 // A: Timestamp
          teamCode,           // B: Team Code
          act,                // C: Activity
          nn,                 // D: Nonce ✅
          JSON.stringify(payload), // E: Payload (JSON string)
          "PENDING",          // F: AI Status
          "0",                // G: AI Attempts
          "",                 // H: AI Score
          "",                 // I: Final Score
          idem,               // J: Idempotency
          eventId,            // K: Event Id
          "",                 // L: Last Attempt At (Zap fills)
          ""                  // M: Zap Error (Zap fills)
        ]]
      }
    });

    // ---- Notify Zapier Catch Hook (webhook-triggered Zap) ----
    // Your env var name:
    const hookUrl =
      process.env.ZAP_KINDNESS_HOOK ||             // <— your chosen name
      process.env.ZAPIER_KINDNESS_HOOK_URL || "";  // fallback if you ever rename
    if (hookUrl) {
      const zapPayload = {
        // identifiers
        activity: act,
        event_id: eventId,
        team_code: teamCode,
        team_name: teamName || "",
        timestamp: ts,
        nonce: nn,
        submission_id: subId || "",
        idempotency: idem,
        // content
        photoUrl: String(photoUrl || ""),
        description: String(what || ""),
        where: String(where || "")
      };

      try {
        await fetch(hookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.ZAPIER_KINDNESS_TOKEN
              ? { "X-Webhook-Token": process.env.ZAPIER_KINDNESS_TOKEN }
              : {})
          },
          body: JSON.stringify(zapPayload)
        });
      } catch (e) {
        console.warn("Zapier hook post failed:", e?.message || e);
        // Don't throw — Sheets write already completed
      }
    }

    // ---- Response ----
    return ok({
      success: true,
      version: "kindness-fn-2025-10-20-2",
      nonce: nn,
      idempotency: idem,
      timestamp: ts
    });
  } catch (e) {
    console.error("submit_kindness_function:", e);
    return error(500, e.message || "Unexpected error");
  }
};
