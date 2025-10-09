// netlify/functions/get_cluehunt_submissions_function.js
const { ok, error, isPreflight, getSheets, SHEET_ID } = require("./_utils.js");

function lcHeaders(row = []) {
  const out = {};
  (row || []).forEach((h, i) => (out[String(h || "").trim().toLowerCase()] = i));
  return out;
}

function activityKey(raw = "") {
  const k = String(raw || "").trim().toLowerCase();
  if (["clue hunt", "cluehunt", "clue", "treasure", "treasure hunt"].includes(k)) return "cluehunt";
  return null;
}

function pick(idx, row, ...names) {
  for (const n of names) {
    const i = idx[n];
    if (i != null && i >= 0) return row[i];
  }
  return undefined;
}

function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return error(400, "Invalid JSON"); }

    const rawTeam = (body.teamCode || "").toString().trim();
    const rawEvent = (body.eventId || "").toString().trim();
    if (!rawTeam) return error(400, "teamCode is required");

    const teamCodeWanted  = rawTeam;
    const eventIdWantedUC = rawEvent.toUpperCase();

    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "submissions!A:Z",
    }).catch(() => null);

    const values = res?.data?.values || [];
    if (!values.length) return ok({ success: true, submissions: [], totalScore: 0 });

    const header = values[0] || [];
    const rows = values.slice(1);
    const idx = lcHeaders(header);

    // Common columns (case-insensitive, with fallbacks)
    const iTeam   = idx["team code"] ?? idx["team"];
    const iEvent  = idx["event id"] ?? idx["eventid"];
    const iAct    = idx["activity"];
    const iClue   = idx["clue id"] ?? idx["clueid"];
    const iUser   = idx["user answer"] ?? idx["answer"];
    const iCor    = idx["correct answer"] ?? idx["correct"];
    const iScore  = idx["final score"] ?? idx["score"] ?? idx["points"];
    const iTs     = idx["timestamp"] ?? idx["attempt time"] ?? idx["time"];
    const iStat   = idx["status"] ?? idx["ai status"];
    const iPayload= idx["payload"];

    const perClue = new Map(); // clueId -> best submission

    for (const r of rows) {
      const teamCode  = (iTeam != null ? (r[iTeam] || "") : "").trim();
      if (teamCode !== teamCodeWanted) continue;

      // Event filter: only enforce when an Event Id column exists
      const rowEvent = (iEvent != null ? (r[iEvent] || "") : "").toString().trim();
      if (rawEvent && iEvent != null && rowEvent.toUpperCase() !== eventIdWantedUC) continue;

      const act = activityKey((iAct != null ? r[iAct] : "") || "");
      if (act !== "cluehunt") continue;

      const status = ((iStat != null ? r[iStat] : "") || "").toString().trim().toLowerCase();
      // Prefer FINAL; if no status column, accept the row
      if (iStat != null && status && status !== "final") continue;

      // Pull data either from dedicated columns, or from legacy JSON payload
      let clueId = toNum(pick(idx, r, "clue id", "clueid"), NaN);
      let userAnswer = pick(idx, r, "user answer", "answer") || "";
      let correctAnswer = pick(idx, r, "correct answer", "correct") || "";
      let points = toNum(pick(idx, r, "final score", "score", "points"), 0);
      let when = pick(idx, r, "timestamp", "attempt time", "time") || "";

      if (Number.isNaN(clueId) || (!userAnswer && !correctAnswer && !points)) {
        // Legacy row with JSON in "payload"
        const payloadStr = (iPayload != null ? r[iPayload] : "") || "";
        try {
          const p = JSON.parse(payloadStr || "{}");
          if (Number.isNaN(clueId)) clueId = toNum(p.clueId, NaN);
          userAnswer    = userAnswer || p.userAnswer || "";
          correctAnswer = correctAnswer || p.correctAnswer || "";
          points        = points || toNum(p.points, 0);
          when          = when || p.attemptTime || "";
        } catch { /* ignore parse errors */ }
      }

      // If still no clueId, skip row
      if (!Number.isFinite(clueId) || clueId <= 0) continue;

      const cand = {
        clueId: Number(clueId),
        userAnswer: String(userAnswer || ""),
        correctAnswer: String(correctAnswer || ""),
        points: toNum(points, 0),
        attemptTime: String(when || "")
      };

      // Dedupe rule: prefer higher points; if tie, prefer later timestamp
      const prev = perClue.get(cand.clueId);
      if (!prev) perClue.set(cand.clueId, cand);
      else {
        if (cand.points > prev.points) perClue.set(cand.clueId, cand);
        else if (cand.points === prev.points && cand.attemptTime > prev.attemptTime) perClue.set(cand.clueId, cand);
      }
    }

    const submissions = [...perClue.values()].sort((a,b)=> a.clueId - b.clueId);
    const totalScore = submissions.reduce((sum, s)=> sum + toNum(s.points, 0), 0);

    return ok({ success:true, submissions, totalScore });
  } catch (e) {
    console.error("get_cluehunt_submissions_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
