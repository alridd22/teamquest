const { ok, bad, requireAdmin } = require("./_lib/http");
const { listTeamsByEventId } = require("./_lib/sheets");

exports.handler = async (event) => {
  try {
    requireAdmin(event);
    const url = new URL(event.rawUrl || `https://${event.headers.host}${event.path}`);
    const eventId = url.searchParams.get("eventId") || "EVT-19-08-2025";

    const rows = await listTeamsByEventId(eventId);
    const teams = rows.map(r => {
      const returnedAt = r["ReturnedAt (ISO)"] || null;
      const penalty = Number(r["LatePenalty"] || r["Penalty"] || 0) || 0;
      return {
        teamCode: r["Team Code"],
        teamName: r["Team Name"],
        locked: String(r["Locked"]||"").toUpperCase()==="TRUE",
        returnedAt,
        returned: !!returnedAt,
        penalty
      };
    });

    return ok({ teams });
  } catch (e) {
    return bad(e.status || 500, e.message || "Error");
  }
};
