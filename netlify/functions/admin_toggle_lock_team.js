// admin_toggle_lock_team.js
const { ok, bad, requireAdmin, getBody } = require("./_lib/http");
const { setTeamLock } = require("./_lib/sheets");

exports.handler = async (event) => {
  try {
    requireAdmin(event);
    const { eventId, teamCode, locked } = getBody(event);
    if (!eventId || !teamCode || typeof locked === "undefined") return bad(400, "eventId, teamCode, locked required");

    const row = await setTeamLock(eventId, teamCode, !!locked);
    return ok({ teamCode, locked: String(row["Locked"]).toUpperCase()==="TRUE" });
  } catch (e) {
    return bad(e.status || 500, e.message || "Error");
  }
};
