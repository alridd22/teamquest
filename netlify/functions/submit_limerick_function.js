// netlify/functions/submit_limerick_function.js
const { ok, error, isPreflight, getSheets, tabRange, SHEET_ID } = require("./_utils.js");
const https = require("node:https");

// ---------- helpers ----------
async function ensureSheetExists(sheets, spreadsheetId, title, headers) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some(s => s.properties?.title === title);
  if (exists) {
    // Ensure the two reliability columns exist at the far right
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
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

// Optional: normalize Uploadcare URLs to a fast, small JPEG
function optimizeUploadcare(url) {
  const m = /ucarecdn\.com\/([^/?#]+)/.exec(url || "");
  if (!m) return url;
  const id = m[1];
  return `https://ucarecdn.com/${id}/-/scale_crop/1600x1600/center/-/quality/smart/-/format/jpeg/`;
}

// Robust webhook post (with retries/backoff) — returns { ok:boolean, err?:string }
async function postToZapHook(url, data, submissionId) {
  if (!url) return { ok: false, err: "Missing ZAP_LIMERICK_HOOK" };
  const waits = [0, 800, 3000]; // ms
  let lastErr = "unknown";
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) await new Promise(r => setTimeout(r, waits[i]));
    try {
      // Prefer global fetch (Netlify Node 18+); fallback to https
      if (typeof fetch === "function") {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000); // 10s
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
      } else {
        // Fallback (rare)
        await new Promise((resolve, reject) => {
          try {
            const u = new URL(url);
            const req = https.request({
              host: u.hostname,
              path: `${u.pathname}${u.search || ""}`,
              port: u.port || (u.protocol === "https:" ? 443 : 80),
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Submission-Id": submissionId
              },
              timeout: 10000
            }, res => { res.on("data", () => {}); res.on("end", () => {
              if (res.statusCode >= 200 && res.statusCode < 300) resolve();
              else reject(new Error(`Zap ${res.statusCode}`));
            }); });
            req.on("timeout", () => req.destroy(new Error("timeout")));
            req.on("error", reject);
            req.write(JSON.stringify(data));
            req.end();
          } catch (e) { reject(e); }
        });
        return { ok: true };
      }
    } catch (e) {
      lastErr = e && e.message ? e.message : String(e);
    }
  }
  return { ok: false, err: lastErr };
}

// Parse "submissions!A2:M2" -> 2
function parseRowNumberFromUpdatedRange(updatedRange) {
  const m = /!(?:[A-Z]+)(\d+):/.exec(updatedRange || "");
  return m ? parseInt(m[1], 10) : null;
}

// ---------- handler ----------
module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return error(400, "Invalid JSON body"); }

    const activity  = "limerick";
    const eventId   = (body.eventId || "").toString().trim();
    const teamCode  = (body.teamCode || "").toString().trim();
    const teamName  = (body.teamName || "").toString().trim();

    const limerickText = (body.limerick || body.text || "").toString().trim(); // required
    const topic        = (body.topic || "").toString().trim();
    const photoUrlRaw  = (body.photoUrl || "").toString().trim(); // optional (some events attach a pic)
    const photoUrlOptimized = photoUrlRaw ? optimizeUploadcare(photoUrlRaw) : "";

    if (!teamCode) return error(400, "teamCode is required");
    if (limerickText.length < 20) return error(400, "limerick text must be at least 20 characters");

    const sheets = await getSheets();
    await ensureSheetExists(
      sheets,
      SHEET_ID,
      "submissions",
      [
        "Timestamp","Team Code","Activity","Nonce","Payload",
        "AI Status","AI Attempts","AI Score","Final Score","Idempotency","Event Id",
        "Last Attempt At","Zap Error"
      ]
    );

    const timestamp   = new Date().toISOString();
    const nonce       = randNonce(6);
    const idempotency = `${activity}|${eventId}|${teamCode}`;

    const payloadObj = {
      limerick: limerickText,
      topic,
      photoUrl: photoUrlRaw || undefined,
      photoUrlOptimized: photoUrlOptimized || undefined,
      teamName
    };
    const payloadStr = JSON.stringify(payloadObj);

    // Append the row in PROCESSING state
    const appendRes = await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: tabRange("submissions", "A1"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[
        timestamp,           // A Timestamp
        teamCode,            // B Team Code
        activity,            // C Activity
        nonce,               // D Nonce
        payloadStr,          // E Payload (JSON)
        "PROCESSING",        // F AI Status  (not QUEUED)
        0,                   // G AI Attempts
        "",                  // H AI Score
        "",                  // I Final Score
        idempotency,         // J Idempotency
        eventId,             // K Event Id
        timestamp,           // L Last Attempt At
        ""                   // M Zap Error
      ]]}
    });

    // Fire the Zap webhook with retries; if it ultimately fails, mark row ERROR.
    const hook = process.env.ZAP_LIMERICK_HOOK || "";
    const post = await postToZapHook(hook, {
      activity, eventId, teamCode, teamName, timestamp, nonce,
      idempotency, sheetId: SHEET_ID, worksheet: "submissions",
      payload: payloadObj
    }, nonce);

    if (!post.ok) {
      // Best-effort update to flag ERROR and capture message
      try {
        const updatedRange = appendRes.data?.updates?.updatedRange; // e.g., "submissions!A2:M2"
        const rowNum = parseRowNumberFromUpdatedRange(updatedRange);
        if (rowNum) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `submissions!F${rowNum}:M${rowNum}`,
            valueInputOption: "RAW",
            requestBody: {
              values: [[
                "ERROR",     // F AI Status
                1,           // G AI Attempts
                "",          // H AI Score
                "",          // I Final Score
                idempotency, // J (keep)
                eventId,     // K (keep)
                new Date().toISOString(),                 // L Last Attempt At
                String(post.err || "Webhook failed").slice(0, 200) // M Zap Error
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
      message: post.ok ? "Limerick submission processing" : "Limerick submission queued with retry",
      teamCode, teamName, eventId, nonce
    });
  } catch (e) {
    console.error("submit_limerick_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
