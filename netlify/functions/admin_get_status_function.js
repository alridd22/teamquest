// admin_get_status_function.js (CommonJS, standardised helpers)

const {
  ok, error, isPreflight, requireAdmin,
  getDoc, getOrCreateSheet, getCompetitionMap,
  CURRENT_EVENT
} = require("./_utils.js");

module.exports.handler = async (event) => {
  try {
    // Handle OPTIONS with CORS via ok()
    if (isPreflight(event)) return ok({});
    requireAdmin(event);

    const doc = await getDoc();

    // Competition KV
    const { map, sheet: compSheet } = await getCompetitionMap(doc, CURRENT_EVENT);
    const state          = map.state || "PENDING";
    const start_at       = map.start_at || "";
    const publish_at     = map.publish_at || "";
    const gallery_unlocked = map.gallery_unlocked === "true";

    // Teams registration check
    const teams = await getOrCreateSheet(doc, "teams", [
      "Team Code", "Team Name", "PIN", "State", "Device", "LastSeen", "Event Id"
    ]);
    const trows = await teams.getRows();
    const mine  = trows.filter(r => String(r.get("Event Id")) === String(CURRENT_EVENT));
    const totalTeams = mine.length;
    const unregistered = mine.filter(r => !(r.get("Team Name")) && r.get("PIN"));
    const registeredCount = totalTeams - unregistered.length;

    // Check-ins
    const checkins = await getOrCreateSheet(doc, "checkins", [
      "Team Code", "CheckedInAt", "Status", "Penalty", "Event Id"
    ]);
    const crows = await checkins.getRows();
    const myCheckins = crows.filter(r => String(r.get("Event Id")) === String(CURRENT_EVENT));
    const checkedInTeams = new Set(myCheckins.map(r => r.get("Team Code")));

    return ok({
      success: true,
      event: CURRENT_EVENT,
      state,
      start_at,
      publish_at,
      gallery_unlocked,
      totals: {
        totalTeams,
        registeredCount,
        uncheckedCount: totalTeams - checkedInTeams.size
      },
      unregisteredTeams: unregistered.map(r => r.get("Team Code"))
    });
  } catch (e) {
    console.error("admin_get_status_function error:", e);
    const code = e.statusCode || 400;
    return error(code, e.message || "Admin status error");
  }
};
