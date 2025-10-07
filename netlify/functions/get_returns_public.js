// /netlify/functions/get_returns_public.js
const { ok, bad } = require("./_lib/http");
const { listTeamsByEventId } = require("./_lib/sheets");

/**
 * Public, read-only endpoint that exposes which teams have returned.
 * No auth. Only returns safe fields.
 * Query: ?eventId=EVT-...
 */
exports.handler = async (event) => {
  try {
    const url = new URL(event.rawUrl || `https://${event.headers.host}${event.path}`);
    const eventId = url.searchParams.get("eventId") || url.searchParams.get("event");
    if (!eventId) return bad(400, "Missing eventId");

    const rows = await listTeamsByEventId(eventId);
    const returns = (rows || []).map(r => {
      const teamCode = String(r["Team Code"] || "").trim();
      const teamName = String(r["Team Name"] || teamCode || "—").trim();
      const returnedAt = (r["ReturnedAt (ISO)"] || "").toString().trim();
      const returned = !!returnedAt ||
        String(r["Returned"] || "").toUpperCase().trim() === "TRUE";
      return { teamCode, teamName, returnedAt, returned };
    });

    return ok({ eventId, returns });
  } catch (e) {
    return bad(e.status || 500, e.message || "Error");
  }
};
