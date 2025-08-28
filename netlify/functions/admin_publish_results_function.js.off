// admin_publish_results_function.js (CommonJS, standardised helpers)

const {
  ok, error, isPreflight, requireAdmin,
  getDoc, getCompetitionMap, setCompetitionValue, nowIso,
  CURRENT_EVENT
} = require("./_utils.js");

module.exports.handler = async (event) => {
  try {
    // Handle OPTIONS + CORS
    if (isPreflight(event)) return ok({});
    requireAdmin(event);

    const doc = await getDoc();
    const { map, sheet } = await getCompetitionMap(doc, CURRENT_EVENT);

    // Idempotent: if already PUBLISHED, just return current state
    if ((map.state || "") === "PUBLISHED") {
      return ok({
        success: true,
        state: "PUBLISHED",
        publish_at: map.publish_at || "",
        gallery_unlocked: map.gallery_unlocked === "true"
      });
    }

    // Optionally enforce “checked-in before publish” here if you add that rule later.

    // Set state to PUBLISHED + publish_at + unlock gallery
    const when = map.publish_at || (nowIso ? nowIso() : new Date().toISOString());
    await setCompetitionValue(sheet, CURRENT_EVENT, "state", "PUBLISHED");
    await setCompetitionValue(sheet, CURRENT_EVENT, "publish_at", when);
    await setCompetitionValue(sheet, CURRENT_EVENT, "gallery_unlocked", "true");

    return ok({ success: true, state: "PUBLISHED", publish_at: when, gallery_unlocked: true });
  } catch (e) {
    console.error("admin_publish_results_function error:", e);
    const code = e.statusCode || 400;
    return error(code, e.message || "Admin publish error");
  }
};
