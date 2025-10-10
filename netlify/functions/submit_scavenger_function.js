// netlify/functions/submit_scavenger_function.js
const { ok, error, isPreflight, getSheets, tabRange, SHEET_ID } = require("./_utils.js");

// --- helpers ---------------------------------------------------------------
async function ensureSheetExists(sheets, spreadsheetId, title, headers) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some(s => s.properties?.title === title);
  if (exists) {
    // Make sure the two new columns exist (appended at the far right)
    const head = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${title}!1:1` });
    const current = (head.data.values && head.data.values[0]) || [];
    const needed = ["Last Attempt At", "Zap Error"];
    if (!needed.every(n => current.includes(n))) {
      const newHeaders = [...current];
      needed.forEach(n => { if (!newHeaders.includes(n)) newHeaders.push(n); });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${title}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [newHeaders] }
      });
    }
    return;
  }
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

// Robust webhook post (with retries/backoff) — returns { ok:boolean, err?:string }
async function postToZapHook(url, data, submissionId) {
  if (!url) return { ok: false, err: "Missing ZAP_SCAVENGER_HOOK" };
  const waits = [0, 800, 3000]; // ms backoff
  let lastErr = "unknown";
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) await new Promise(r => setTimeout(r, waits[i]));
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000); // 10s timeout
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Submission-Id": submissionId
        },
        body: JSON.stringify(data),
        signal: controller.signal
      });
      const txt = await res.text();
      clearTimeout(timer);
      if (res.ok) return { ok: true };
      lastErr = `Zap ${res.status} ${txt?.slice(0,200) || ""}`.trim();
    } catch (e) {
      lastErr = e && e.message ? e.message : String(e);
    }
  }
  return { ok: false, err: lastErr };
}

// Parse "submissions!A2:K2" -> 2
function parseRowNumberFromUpdatedRange(updatedRange) {
  // updatedRange looks like: "<sheetName>!A2:K2"
  const m = /!(?:[A-Z]+)(\d+):/.exec(updatedRange || "");
  return m ? parseInt(m[1], 10) : null;
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

    // Basic validation
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
        "Timestamp",      // A
        "Team Code",      // B
        "Activity",       // C
        "Nonce",          // D
        "Payload",        // E (stringified JSON)
        "AI Status",      // F
        "AI Attempts",    // G
        "AI Score",       // H
        "Final Score",    // I
        "Idempotency",    // J
        "Event Id",       // K
        "Last Attempt At",// L  (new)
        "Zap Error"       // M  (new)
      ]
    );

    const activity    = "scavenger";
    const timestamp   = new Date().toISOString();
    const nonce       = randNonce(6); // our submission key (used by Zap + Retry Bot)
    const idempotency = `${activity}|${eventId}|${teamCode}`;

    // Payload we store in column E
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

    // Optional human-readable submissionId (nonce remains the system key)
    const submissionId = `${activity}-${teamCode}-${slugify(itemId)}-${nonce}`;

    // Append the row (write PROCESSING + attempt=0 + last_attempt_at)
    const appendRes = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: tabRange("submissions", "A1"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          timestamp,       // A Timestamp
          teamCode,        // B Team Code
          activity,        // C Activity
          nonce,           // D Nonce
          payloadStr,      // E Payload
          "PROCESSING",    // F AI Status  (was QUEUED)
          0,               // G AI Attempts
          "",              // H AI Score
          "",              // I Final Score
          idempotency,     // J Idempotency
          eventId,         // K Event Id
          timestamp,       // L Last Attempt At
          ""               // M Zap Error
        ]]
      }
    });

    // Try sending to Zapier (with retries). If it still fails, mark row ERROR.
    const hook = process.env.ZAP_SCAVENGER_HOOK; // set in Netlify env
    const post = await postToZapHook(hook, {
      activity,
      eventId,
      teamCode,
      teamName,
      timestamp,
      nonce,             // <-- primary key used by Zap to find the row
      idempotency,
      submissionId,
      sheetId: SHEET_ID,
      worksheet: "submissions",
      payload: payloadObj
    }, nonce);

    if (!post.ok) {
      // Best-effort update to flag ERROR and capture message
      try {
        const updatedRange = appendRes.data?.updates?.updatedRange; // e.g., "submissions!A2:M2"
        const rowNum = parseRowNumberFromUpdatedRange(updatedRange);
        if (rowNum) {
          // Update F (AI Status), G (Attempts), L (Last Attempt At), M (Zap Error)
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `submissions!F${rowNum}:M${rowNum}`,
            valueInputOption: "RAW",
            requestBody: {
              values: [[
                "ERROR",     // F
                1,           // G attempts bump
                "",          // H (leave score blank)
                "",          // I (leave final score blank)
                idempotency, // J (unchanged but included to keep range contiguous)
                eventId,     // K
                new Date().toISOString(), // L Last Attempt At
                String(post.err).slice(0, 200) // M Zap Error (short)
              ]]
            }
          });
        }
      } catch (e) {
        console.warn("Failed to mark ERROR after webhook failure:", e.message);
      }
    }

    return ok({
      success: true,
      message: post.ok ? "Scavenger submission processing" : "Scavenger submission queued with retry",
      submissionId,
      nonce,
      teamCode,
      teamName,
      eventId
    });
  } catch (e) {
    console.error("submit_scavenger_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
