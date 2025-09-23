// check-clue-completion.js
const { ok, error, isPreflight, getSheets, SHEET_ID } = require("./_utils.js");

function lcHeaders(row = []) {
  const out = {};
  (row || []).forEach((h, i) => (out[String(h || "").trim().toLowerCase()] = i));
  return out;
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return error(400, "Invalid JSON"); }

    const { teamCode } = body || {};
    if (!teamCode) return error(400, "teamCode is required");

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "submissions!A:Z",
    }).catch(() => null);

    const values = res?.data?.values || [];
    if (!values.length) return ok({ success: true, completed: false, totalScore: 0 });

    const header = values[0] || [];
    const rows = values.slice(1);
    const idx = lcHeaders(header);

    const seenClues = new Set();
    let total = 0;

    for (const r of rows) {
      const rTeam = (r[idx["team code"]] || "").trim();
      if (rTeam !== teamCode) continue;

      const act = String(r[idx["activity"]] || "").toLowerCase().trim();
      if (!["clue", "cluehunt", "clue hunt", "treasure", "treasure hunt"].includes(act)) continue;

      const payloadStr = r[idx["payload"]] || "";
      const finalScore = Number(r[idx["final score"]] || 0) || 0;

      try {
        const p = JSON.parse(payloadStr || "{}");
        if (p.clueId != null) seenClues.add(Number(p.clueId));
      } catch { /* ignore */ }

      total += finalScore;
    }

    const completed = seenClues.size >= 20; // all 20 attempted (correct or not)
    return ok({ success: true, completed, totalScore: total });

  } catch (e) {
    console.error("check-clue-completion error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
