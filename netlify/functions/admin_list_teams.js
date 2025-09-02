// admin_list_teams.js
const { ok, bad, requireAdmin } = require("./_lib/http");
const { listTeamsByEventId } = require("./_lib/sheets");

exports.handler = async (event) => {
  try {
    requireAdmin(event);
    const url = new URL(event.rawUrl || `https://${event.headers.host}${event.path}`);
    const eventId = url.searchParams.get("eventId") || "EVT-19-08-2025";

    const rows = await listTeamsByEventId(eventId);
    const teams = rows.map(r => ({
      teamCode: r["Team Code"],
      teamName: r["Team Name"],
      locked: String(r["Locked"]||"").toUpperCase()==="TRUE",
      returnedAt: r["ReturnedAt (ISO)"] || null
    }));

    return ok({ teams });
  } catch (e) {
    return bad(e.status || 500, e.message || "Error");
  }
};
