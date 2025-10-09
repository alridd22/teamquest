// netlify/functions/get_gallery.js
const { ok, error, isPreflight, getSheets, SHEET_ID } = require("./_utils.js");

const SUBMISSIONS_SHEET = "submissions";

function idxOf(headers, name) {
  const i = headers.findIndex(h => String(h || "").trim().toLowerCase() === name.toLowerCase());
  return i === -1 ? null : i;
}
function safeJson(s) { try { return JSON.parse(String(s || "{}")); } catch { return {}; } }
function guessMimeFromB64(head = "") {
  if (head.startsWith("iVBOR")) return "image/png";
  if (head.startsWith("R0lGOD")) return "image/gif";
  if (head.startsWith("UklGR")) return "image/webp";
  return "image/jpeg";
}
function toDataUrl(b64 = "") {
  if (!b64) return "";
  if (b64.startsWith("data:")) return b64;
  const mime = guessMimeFromB64(b64.slice(0, 5));
  return `data:${mime};base64,${b64}`;
}
function normState(s = "") {
  const v = String(s || "").toLowerCase();
  if (["published"].includes(v)) return "published";
  if (["running", "started", "active"].includes(v)) return "running";
  if (["paused"].includes(v)) return "paused";
  if (["ended", "finished", "complete"].includes(v)) return "ended";
  return "notstarted";
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "GET") return error(405, "GET only");

    const qs = event.queryStringParameters || {};
    const eventId = (qs.eventId || qs.event || "").trim();

    // 1) Check event state to respect publish lock
    let published = false;
    try {
      const base = process.env.URL || process.env.DEPLOY_PRIME_URL || "";
      const url = `${base}/.netlify/functions/get_event_state?eventId=${encodeURIComponent(eventId)}`;
      const r = await fetch(url);
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        const st = normState(j.state || (j.published ? "published" : ""));
        published = (st === "published");
      }
    } catch {
      // If state function is unavailable, default to locked (safer).
      published = false;
    }

    const sheets = await getSheets();
    if (!sheets) return error(500, "Spreadsheet client not available");

    // 2) Read submissions
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SUBMISSIONS_SHEET}!A1:K`,
    });
    const rows = resp.data.values || [];
    if (rows.length < 2) {
      return ok({ success: true, published, limerick: [], kindness: [] });
    }

    const header = rows[0].map(h => String(h || "").trim());
    const iTimestamp = idxOf(header, "Timestamp");
    const iTeamCode  = idxOf(header, "Team Code");
    const iActivity  = idxOf(header, "Activity");
    const iPayload   = idxOf(header, "Payload");
    const iEvent     = idxOf(header, "Event Id");

    // 3) Collect latest per (activity|team)
    const latest = new Map(); // key: `${activity}|${teamCodeOrName}` -> item

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];

      const activity = String(row[iActivity] || "").trim().toLowerCase();
      if (activity !== "limerick" && activity !== "kindness") continue;

      const rowEventId = String(row[iEvent] || "").trim();
      if (eventId && rowEventId && rowEventId.toUpperCase() !== eventId.toUpperCase()) continue;

      const payload = safeJson(row[iPayload]);
      const teamName = String(payload.teamName || payload.team || "").trim();
      const teamCode = String(row[iTeamCode] || "").trim();

      const ts = iTimestamp != null ? Date.parse(row[iTimestamp]) || 0 : 0;

      const text = activity === "limerick"
        ? String(payload.limerick || payload.text || "")
        : String(payload.what || payload.description || payload.text || "");

      const imageUrl = String(payload.photoUrl || payload.imageUrl || "");
      const photoB64 = String(payload.photoBase64 || "");

      const key = `${activity}|${(teamCode || teamName || `row${r}`).toUpperCase()}`;
      const item = {
        activity,
        teamName: teamName || teamCode || "Unknown Crew",
        teamCode,
        eventId: rowEventId || eventId || "",
        text,
        imageUrl: imageUrl || (photoB64 ? toDataUrl(photoB64) : ""),
        timestamp: ts,
      };

      const prev = latest.get(key);
      if (!prev || ts >= prev.timestamp) latest.set(key, item);
    }

    // 4) Split into arrays
    const limerick = [];
    const kindness = [];
    for (const v of latest.values()) {
      if (v.activity === "limerick") limerick.push(v);
      else if (v.activity === "kindness") kindness.push(v);
    }

    // Newest first
    limerick.sort((a,b) => b.timestamp - a.timestamp);
    kindness.sort((a,b) => b.timestamp - a.timestamp);

    return ok({ success: true, published, limerick, kindness });
  } catch (e) {
    console.error("get_gallery error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
