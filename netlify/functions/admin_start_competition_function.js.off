// admin_start_competition_function.js (CommonJS, consistent utils)

const {
  ok, error, isPreflight, requireAdmin,
  getDoc, getOrCreateSheet, getCompetitionMap, setCompetitionValue, nowIso,
  CURRENT_EVENT
} = require("./_utils.js");

module.exports.handler = async (event) => {
  try {
    // Handle CORS preflight
    if (isPreflight(event)) return ok({});
    requireAdmin(event);

    const doc = await getDoc();

    // ===== Ensure all teams for event exist; optional strictness =====
    const teams = await getOrCreateSheet(doc, "teams", [
      "Team Code", "Team Name", "PIN", "State", "Device", "LastSeen", "Event Id"
    ]);
    const rows = await teams.getRows();
    const mine = rows.filter(r => String(r.get("Event Id")) === String(CURRENT_EVENT));
    const unregistered = mine.filter(r => !(r.get("Team Name")) && r.get("PIN"));

    if (unregistered.length > 0) {
      // If you prefer to allow force start: remove this block, or add query ?force=true
      const qs = event.queryStringParameters || {};
      const force = qs.force === "true" || qs.force === "1";
      if (!force) {
        return error(400, "Some teams are not registered (name+PIN missing)", {
          unregistered: unregistered.map(r => r.get("Team Code"))
        });
      }
    }

    // ===== Competition KV =====
    const { map, sheet: compSheet } = await getCompetitionMap(doc, CURRENT_EVENT);
    const state = map.state || "PENDING";
    if (state === "OPEN" || state === "CHECKIN" || state === "PUBLISHED") {
      // idempotent: already started (OPEN or later)
      return ok({ success: true, state, start_at: map.start_at || "" });
    }

    // set OPEN
    await setCompetitionValue(compSheet, CURRENT_EVENT, "state", "OPEN");
    const started = map.start_at || (nowIso ? nowIso() : new Date().toISOString());
    await setCompetitionValue(compSheet, CURRENT_EVENT, "start_at", started);

    return ok({ success: true, state: "OPEN", start_at: started });
  } catch (e) {
    console.error("admin_start_competition_function error:", e);
    const code = e.statusCode || 400;
    return error(code, e.message || "Admin start error");
  }
};
