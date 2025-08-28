// admin_add_penalty_function.js (CommonJS)

const {
  ok, error, isPreflight, requireAdmin, appendRows, tabRange, getSheets
} = require("./_utils.js");

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    requireAdmin(event);

    const { teamId, points, note } = JSON.parse(event.body || "{}");
    if (!teamId || typeof points !== "number") {
      return error(400, "teamId and points (number) required");
    }
    // Usually a negative number, e.g., -5
    const sheets = await getSheets();

    await appendRows(sheets, null, tabRange("Scores", "A1"), [[
      teamId,
      "late_penalty",
      points.toString(),
      note ? `admin:${note}` : "admin",
      ""
    ]]);

    return ok({ added: true });
  } catch (e) {
    console.error("admin_add_penalty_function error:", e);
    return error(400, e.message);
  }
};
