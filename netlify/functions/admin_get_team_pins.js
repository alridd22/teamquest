// netlify/functions/admin_get_team_pins.js
const { ok, error, isPreflight, getSheets, SHEET_ID } = require("./_utils.js");

/** lower-cased header index map */
function lcHeaders(row = []) {
  const out = {};
  (row || []).forEach((h, i) => (out[String(h || "").trim().toLowerCase()] = i));
  return out;
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
      return error(405, "Use GET or POST");
    }

    // admin auth is optional here – if you gate others endpoints with an admin key,
    // you can mirror that check here as well.

    // Accept eventId from either verb; but we do NOT require it
    let body = {};
    try { if (event.httpMethod === "POST") body = JSON.parse(event.body || "{}"); } catch {}
    const qs = new URLSearchParams(event.queryStringParameters || {});
    const eventId = (body.eventId || qs.get("eventId") || qs.get("event") || "").trim();

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    // Read the "teams" tab exactly
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "teams!A:Z",
    }).catch(() => null);

    const values = res?.data?.values || [];
    if (!values.length) return ok({ success: true, pins: [] });

    const header = values[0] || [];
    const rows = values.slice(1);
    const idx = lcHeaders(header);

    const iCode = idx["team code"];
    const iName = idx["team name"];
    const iPin  = idx["pin"];
    const iEvt  = (idx["event id"] ?? idx["event"] ?? idx["evt"] ?? -1);

    if (iCode == null || iPin == null) {
      return error(400, "teams sheet missing required headers (Team Code, PIN)");
    }

    const pins = [];
    for (const r of rows) {
      const code = String(r[iCode] || "").trim();
      const name = String((iName != null ? r[iName] : "") || "").trim();
      const pin  = String(r[iPin]  || "").trim();
      const evt  = (iEvt != null ? String(r[iEvt] || "").trim() : "");

      if (!code || !pin) continue;
      if (eventId && iEvt != null && evt && evt.toUpperCase() !== eventId.toUpperCase()) continue;

      pins.push({ teamCode: code, teamName: name, pin, eventId: evt });
    }

    return ok({ success: true, pins });
  } catch (e) {
    console.error("admin_get_team_pins error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
