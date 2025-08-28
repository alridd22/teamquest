// admin_begin_checkins_function.js (CommonJS, consistent utils)

const {
  ok, error, isPreflight, requireAdmin,
  CURRENT_EVENT,
  getDoc, getCompetitionMap, setCompetitionValue
} = require("./_utils.js");

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({}); // handles OPTIONS with CORS headers
    requireAdmin(event);

    const doc = await getDoc();
    const { map, sheet } = await getCompetitionMap(doc, CURRENT_EVENT);

    const state = map.state || "PENDING";
    if (state === "PUBLISHED") return ok({ success: true, state });
    if (state === "CHECKIN")   return ok({ success: true, state }); // idempotent

    // Allow switching from OPEN -> CHECKIN
    await setCompetitionValue(sheet, CURRENT_EVENT, "state", "CHECKIN");
    return ok({ success: true, state: "CHECKIN" });
  } catch (e) {
    console.error("admin_begin_checkins_function error:", e);
    const code = e.statusCode || 400;
    return error(code, e.message || "Admin begin check-ins error");
  }
};
