// netlify/functions/get_clues_function.js
const { ok, error, isPreflight, getSheets, tabRange, SHEET_ID } = require("./_utils.js");

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "GET") return error(405, "GET only");

    const sheets = await getSheets();
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: tabRange("ClueBank", "A:C"),
    });

    const v = r.data.values || [];
    const head = v[0] || [];
    const idx = {}; head.forEach((h, i) => (idx[h] = i));

    const clues = v.slice(1)
      .filter(row => (row[idx["ClueID"]] ?? "").trim() !== "")
      .map(row => ({
        clueId: row[idx["ClueID"]] ?? row[0] ?? "",
        // Don’t send correct answers to the client.
        points: Number(row[idx["Points"]] ?? row[2] ?? 0),
      }));

    return ok({ success: true, clues });
  } catch (e) {
    console.error("get_clues_function:", e);
    return error(500, e.message || "Unexpected error");
  }
};
