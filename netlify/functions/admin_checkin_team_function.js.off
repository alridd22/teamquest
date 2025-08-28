// admin_checkin_team_function.js (CommonJS)

const {
  ok, error, isPreflight, requireAdmin,
  getDoc, getOrCreateSheet, getCompetitionMap,
  CURRENT_EVENT,
  nowIso // if you don't have this in utils, replace with: () => new Date().toISOString()
} = require("./_utils.js");

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({}); // handles OPTIONS with CORS headers
    // (Optionally enforce POST)
    // if (event.httpMethod !== "POST") return error(405, "POST only");

    requireAdmin(event);

    const { teamCode, status, penalty } = JSON.parse(event.body || "{}");
    if (!teamCode) return error(400, "teamCode required");

    // Normalise status (allowed: ON_TIME | LATE | ABSENT)
    const legitStatus = String(status || "ON_TIME").toUpperCase();

    const pen = Number(penalty || 0) || 0;

    const doc = await getDoc();
    const { map, sheet } = await getCompetitionMap(doc, CURRENT_EVENT);

    // Only allow check-ins during CHECKIN or PUBLISHED phases
    const state = map.state || "";
    if (!["CHECKIN", "PUBLISHED"].includes(state)) {
      return error(400, "Check-ins are not active (state must be CHECKIN or PUBLISHED).");
    }

    // Sheet: 'checkins' with expected headers
    const checkins = await getOrCreateSheet(doc, "checkins", [
      "Team Code", "CheckedInAt", "Status", "Penalty", "Event Id"
    ]);
    const rows = await checkins.getRows();

    // Find existing row for this team + event
    const row = rows.find(r =>
      r.get("Team Code") === String(teamCode) &&
      String(r.get("Event Id")) === String(CURRENT_EVENT)
    );

    if (!row) {
      await checkins.addRow({
        "Team Code": teamCode,
        "CheckedInAt": nowIso ? nowIso() : new Date().toISOString(),
        "Status": legitStatus,
        "Penalty": String(pen),
        "Event Id": CURRENT_EVENT
      });
    } else {
      // Keep first check-in time if present
      row.set("CheckedInAt", row.get("CheckedInAt") || (nowIso ? nowIso() : new Date().toISOString()));
      row.set("Status", legitStatus);
      row.set("Penalty", String(pen));
      await row.save();
    }

    return ok({ success: true, teamCode, status: legitStatus, penalty: pen });
  } catch (e) {
    console.error("admin_checkin_team_function error:", e);
    const code = e.statusCode || 400;
    return error(code, e.message || "Admin check-in error");
  }
};
