// Admin: list team PINs (view-only)
// Protects access via X-Admin-Secret (requireAdmin in _utils.js)

const { ok, error, isPreflight, getSheets, SHEET_ID, requireAdmin } = require("./_utils.js");

const RANGES = ["teams!A:Z", "Teams!A:Z", "TEAMS!A:Z"];
const norm = (s="") => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "");
const findIdx = (hdrs, names) => {
  const H = hdrs.map(norm);
  for (const n of names) {
    const i = H.indexOf(norm(n));
    if (i >= 0) return i;
  }
  return -1;
};

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (!["GET", "POST"].includes(event.httpMethod)) return error(405, "Use GET or POST");

    // Admin gate
    try { requireAdmin(event); } catch { return error(403, "Forbidden: bad admin secret"); }

    // Params (GET query or POST body)
    let params = {};
    if (event.httpMethod === "GET") {
      params = event.queryStringParameters || {};
    } else {
      try { params = JSON.parse(event.body || "{}"); }
      catch { return error(400, "Invalid JSON"); }
    }

    const eventIdFilter = String(params.eventId || params.event || "").trim();
    const q = String(params.q || "").trim().toLowerCase();
    const includeEmptyPins = String(params.includeEmptyPins || "false").toLowerCase() === "true";

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    // Load teams sheet (flexible tab name)
    let values = [];
    for (const range of RANGES) {
      try {
        const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
        const v = resp?.data?.values || [];
        if (v.length) { values = v; break; }
      } catch {}
    }
    if (!values.length) return ok({ success: true, count: 0, teams: [] });

    const header = values[0] || [];
    const rows = values.slice(1);

    const iCode = findIdx(header, ["team code", "code", "team_code", "id", "team id"]);
    const iPin  = findIdx(header, ["pin", "passcode", "secret", "password", "access code", "team pin"]);
    const iName = findIdx(header, ["team name", "name", "team_name"]);
    const iEvt  = findIdx(header, ["event id", "event"]);

    if (iCode < 0) return error(500, "Teams sheet missing ‘Team Code’ column");
    if (iPin  < 0) return error(500, "Teams sheet missing ‘PIN’ column");

    let teams = rows.map(r => ({
      teamCode: String(r[iCode] || "").trim(),
      teamName: iName >= 0 ? String(r[iName] || "").trim() : "",
      pin:      String(r[iPin]  || "").trim(),
      eventId:  iEvt >= 0 ? String(r[iEvt]  || "").trim() : ""
    })).filter(t => t.teamCode);

    if (eventIdFilter) {
      const wanted = eventIdFilter.toUpperCase();
      teams = teams.filter(t => (t.eventId || "").toUpperCase() === wanted);
    }
    if (q) {
      teams = teams.filter(t =>
        t.teamCode.toLowerCase().includes(q) ||
        (t.teamName || "").toLowerCase().includes(q)
      );
    }
    if (!includeEmptyPins) {
      teams = teams.filter(t => t.pin);
    }

    teams.sort((a, b) =>
      (a.teamName || a.teamCode).localeCompare(b.teamName || b.teamCode)
    );

    return ok({ success: true, count: teams.length, teams });
  } catch (e) {
    console.error("admin_list_team_pins error:", e);
    return error(500, e.message || "Server error");
  }
};
