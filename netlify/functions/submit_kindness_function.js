// netlify/functions/submit_kindness_function.js
const { ok, error, isPreflight, getSheets, tabRange, SHEET_ID } = require("./_utils.js");
const https = require("node:https");

// ---------- helpers ----------
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
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

// Post JSON using global fetch if present; else node:https (Netlify Node16 safe)
function postJson(url, data, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    if (!url) return resolve();
    if (typeof fetch === "function") {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        signal: controller.signal
      }).then(() => { clearTimeout(t); resolve(); })
        .catch(err => { clearTimeout(t); reject(err); });
      return;
    }
    try {
      const u = new URL(url);
      const req = https.request({
        host: u.hostname,
        path: `${u.pathname}${u.search || ""}`,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeout: timeoutMs
      }, res => { res.on("data", () => {}); res.on("end", resolve); });
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
      req.write(JSON.stringify(data));
      req.end();
    } catch (e) { reject(e); }
  });
}

// ---------- handler ----------
module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return error(400, "Invalid JSON body"); }

    const activity  = "kindness";
    const eventId   = (body.eventId || "").toString().trim();
    const teamCode  = (body.teamCode || "").toString().trim();
    const teamName  = (body.teamName || "").toString().trim();

    // flexible payload
    const description = (body.description || body.message || "").toString().trim(); // required
    const photoUrl    = (body.photoUrl || "").toString().trim();                    // optional
    const location    = (body.location || "").toString().trim();

    if (!teamCode) return error(400, "teamCode is required");
    if (description.length < 20) return error(400, "description must be at least 20 characters");

    const sheets = await getSheets();
    await ensureSheetExists(
      sheets,
      SHEET_ID,
      "submissions",
      ["Timestamp","Team Code","Activity","Nonce","Payload","AI Status","AI Attempts","AI Score","Final Score","Idempotency","Event Id"]
    );

    const timestamp   = new Date().toISOString();
    const nonce       = randNonce(6);
    const idempotency = `${activity}|${eventId}|${teamCode}`;

    const payloadObj = { description, photoUrl, location, teamName };
    const payloadStr = JSON.stringify(payloadObj);

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: tabRange("submissions", "A1"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[
        timestamp, teamCode, activity, nonce, payloadStr,
        "QUEUED", "0", "", "", idempotency, eventId
      ]]}
    });

    // webhook ping (non-blocking)
    const hook = process.env.ZAP_KINDNESS_HOOK || "";
    try {
      await postJson(hook, {
        activity, eventId, teamCode, teamName, timestamp, nonce,
        idempotency, sheetId: SHEET_ID, worksheet: "submissions",
        payload: payloadObj
      });
    } catch (e) {
      console.warn("Kindness hook ping failed:", e.message);
    }

    return ok({
      success: true,
      message: "Kindness submission queued",
      teamCode, teamName, eventId
    });
  } catch (e) {
    console.error("submit_kindness_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
