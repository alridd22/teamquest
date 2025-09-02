// admin_checkin_team.js
const { ok, bad, requireAdmin, getBody } = require("./_lib/http");
const { setTeamReturnedLocked } = require("./_lib/sheets");

exports.handler = async (event) => {
  try {
    requireAdmin(event);
    const { eventId, teamCode, returnedAt } = getBody(event);
    if (!eventId || !teamCode) return bad(400, "eventId and teamCode required");

    const iso = returnedAt || new Date().toISOString();
    const row = await setTeamReturnedLocked(eventId, teamCode, iso, true);

    return ok({ teamCode, locked: true, returnedAt: row["ReturnedAt (ISO)"] });
  } catch (e) {
    return bad(e.status || 500, e.message || "Error");
  }
};
