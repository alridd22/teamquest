// admin_force_recalc_function.js (CommonJS, consistent utils)

const {
  ok, error, isPreflight, requireAdmin,
  getDoc, getCompetitionMap, setCompetitionValue, nowIso,
  CURRENT_EVENT
} = require("./_utils.js");

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({}); // handles OPTIONS with CORS headers
    requireAdmin(event);

    const doc = await getDoc();
    const { sheet } = await getCompetitionMap(doc, CURRENT_EVENT);

    const nonce = String(Date.now());
    await setCompetitionValue(sheet, CURRENT_EVENT, "cache_bust", nonce);
    await setCompetitionValue(
      sheet,
      CURRENT_EVENT,
      "last_recalc_at",
      nowIso ? nowIso() : new Date().toISOString()
    );

    return ok({ success: true, cache_bust: nonce });
  } catch (e) {
    console.error("admin_force_recalc_function error:", e);
    const code = e.statusCode || 400;
    return error(code, e.message || "Admin recalc error");
  }
};
