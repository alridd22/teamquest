// netlify/functions/submit_scavenger_function.js
const { ok, error, isPreflight, getSheets, tabRange, SHEET_ID } = require("./_utils.js");

// --- helpers ---------------------------------------------------------------
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

function randNonce(len = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/I/1 ambiguity
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function slugify(s = "") {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "item";
}

// Non-blocking Zap ping (failsafe, 4s timeout)
async function pingZapHook(url, data) {
  if (!url) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: controller.signal
    });
  } catch (e) {
    console.warn("Zap hook ping failed (non-blocking):", e.message);
  } finally {
    clearTimeout(timer);
  }
}

// --------------------------------------------------------------------------
module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    // Parse & normalize body
    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return error(400, "Invalid JSON body"); }

    const eventId  = (body.eventId || "").toString().trim(); // optional but recommended
    const teamCode = (body.teamCode || "").toString().trim();
    const teamName = (body.teamName || "").toString().trim();
    const photoUrl = (body.photoUrl || "").toString().trim();

    // Accept both shapes:
    // - legacy: itemTitle, itemId, itemDescription
    // - new: items[], description, location
    const items = Array.isArray(body.items) ? body.items.map(String) : [];
    const itemTitle = (body.itemTitle || (items[0] || "")).toString();
    const itemId    = (body.itemId || slugify(itemTitle)).toString();
    const description = (body.description || body.itemDescription || "").toString();
    const location    = (body.location || "").toString();
    const maxPoints   = Number.isFinite(+body.maxPoints) ? +body.maxPoints : 15;

    // Basic validation (keep clear & friendly)
    if (!teamCode) return error(400, "teamCode is required");
    if (!itemTitle && items.length === 0) return error(400, "itemTitle or items[] is required");
    if (!photoUrl) return error(400, "photoUrl is required");

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    // Ensure target sheet exists with canonical headers
    await ensureSheetExists(
      sheets,
      spreadsheetId,
      "submissions",
      [
        "Timestamp",   // A
        "Team Code",   // B
        "Activity",    // C
        "Nonce",       // D
        "Payload",     // E (stringified JSON)
        "AI Status",   // F
        "AI Attempts", // G
        "AI Score",    // H
        "Final Score", // I
        "Idempotency", // J
        "Event Id"     // K
      ]
    );

    const activity   = "scavenger";
    const timestamp  = new Date().toISOString();
    const nonce      = randNonce(6);
    const idempotency = `${activity}|${eventId}|${teamCode}`;

    // Payload we store in column E (friendly & forward-compatible)
    const payloadObj = {
      itemId,
      itemTitle,
      description,
      items,          // keep if provided
      location,       // optional
      photoUrl,
      teamName,
      maxPoints
    };
    const payloadStr = JSON.stringify(payloadObj);

    // Optional submissionId (useful to echo back)
    const submissionId = `${activity}-${teamCode}-${slugify(itemId)}-${nonce}`;

    // Append the row
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: tabRange("submissions", "A1"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          timestamp,       // A Timestamp
          teamCode,        // B Team Code
          activity,        // C Activity
          nonce,           // D Nonce (used by many Zaps)
          payloadStr,      // E Payload
          "QUEUED",        // F AI Status
          "0",             // G AI Attempts
          "",              // H AI Score
          "",              // I Final Score
          idempotency,     // J Idempotency (stable)
          eventId          // K Event Id
        ]]
      }
    });

    // Fire webhook ping (instant Zap trigger, non-blocking)
    try {
      const hook = process.env.ZAP_SCAVENGER_HOOK; // set in Netlify env
      await pingZapHook(hook, {
        activity,
        eventId,
        teamCode,
        teamName,
        timestamp,
        nonce,
        idempotency,
        submissionId,
        sheetId: SHEET_ID,
        worksheet: "submissions",
        payload: payloadObj
      });
    } catch (e) {
      // never fail the request because of the ping
      console.warn("Zap ping warning:", e && e.message);
    }

    return ok({
      success: true,
      message: "Scavenger submission queued",
      submissionId,
      teamCode,
      teamName,
      eventId
    });
  } catch (e) {
    console.error("submit_scavenger_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
