// get_cluehunt_submissions_function.js
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
    if (!values.length) return ok({ success: true, submissions: [], totalScore: 0 });

    const header = values[0] || [];
    const rows = values.slice(1);
    const idx = lcHeaders(header);

    const out = [];
    let total = 0;

    for (const r of rows) {
      const rTeam = (r[idx["team code"]] || "").trim();
      if (rTeam !== teamCode) continue;

      const act = String(r[idx["activity"]] || "").toLowerCase().trim();
      if (!["clue", "cluehunt", "clue hunt", "treasure", "treasure hunt"].includes(act)) continue;

      const payloadStr = r[idx["payload"]] || "";
      const when = r[idx["timestamp"]] || "";
      const finalScore = Number(r[idx["final score"]] || 0) || 0;

      try {
        const p = JSON.parse(payloadStr || "{}");
        out.push({
          clueId: Number(p.clueId || 0),
          clueText: p.clueText || "",
          userAnswer: p.userAnswer || "",
          correctAnswer: p.correctAnswer || "",
          points: Number(p.points || finalScore || 0),
          attemptTime: when || p.attemptTime || ""
        });
      } catch {
        out.push({
          clueId: 0,
          clueText: "",
          userAnswer: "",
          correctAnswer: "",
          points: finalScore,
          attemptTime: when
        });
      }

      total += finalScore;
    }

    // In case duplicates exist, keep latest per clueId & recompute total
    const byClue = new Map();
    for (const s of out) {
      if (!s.clueId) continue;
      const key = String(s.clueId);
      const prev = byClue.get(key);
      if (!prev || (s.attemptTime && s.attemptTime > (prev.attemptTime || ""))) {
        byClue.set(key, s);
      }
    }
    const deduped = [...byClue.values()];
    const recomputedTotal = deduped.reduce((sum, s) => sum + (Number(s.points) || 0), 0);

    return ok({
      success: true,
      submissions: deduped.sort((a, b) => a.clueId - b.clueId),
      totalScore: recomputedTotal
    });

  } catch (e) {
    console.error("get_cluehunt_submissions_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
