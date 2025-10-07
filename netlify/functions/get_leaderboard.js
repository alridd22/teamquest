// /netlify/functions/get_leaderboard.js
const { ok, bad } = require("./_lib/http");
const { listTeamsByEventId } = require("./_lib/sheets");

/**
 * Safely coerce to number
 */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Pull a number from any of several candidate headers on a row
 */
function pickNum(row, keys) {
  for (const k of keys) {
    if (k in row) return num(row[k]);
  }
  return 0;
}

/**
 * Normalise a team row into the leaderboard shape the frontend expects.
 * Includes "returnedAt" and "returned".
 */
function mapRowToTeam(row) {
  const teamCode = (row["Team Code"] || row["teamCode"] || row["Code"] || "").toString().trim();
  const teamName = (row["Team Name"] || row["teamName"] || row["Name"] || teamCode || "—").toString().trim();

  // Scores (accept a variety of column headings)
  const k = pickNum(row, ["Kindness", "kindness", "Kindness Score", "KindnessPoints"]);
  const l = pickNum(row, ["Limerick", "limerick", "Limerick Score", "LimerickPoints"]);
  const s = pickNum(row, ["Scavenger", "scavenger", "Scavenger Hunt", "Scavenger Score", "ScavengerPoints"]);
  const c = pickNum(row, ["ClueHunt", "Clue Hunt", "cluehunt", "Clue Hunt Score", "CluePoints"]);
  const q = pickNum(row, ["Quiz", "quiz", "The Quiz", "Quiz Score", "QuizPoints"]);

  const penalty = pickNum(row, ["LatePenalty", "Penalty", "latePenalty", "late_penalty"]);

  // If a Total-like column exists, use it; otherwise compute sum minus any penalty
  let total = pickNum(row, ["Total", "total", "Score", "Points"]);
  if (total === 0) {
    total = Math.max(0, k + l + s + c + q - penalty);
  }

  // Returned flags
  const returnedAt = (row["ReturnedAt (ISO)"] || row["returnedAt"] || "").toString().trim();
  const returned =
    !!returnedAt ||
    String(row["Returned"] || "")
      .toString()
      .trim()
      .toUpperCase() === "TRUE";

  return {
    teamCode,
    teamName,
    // per-activity
    kindness: k,
    limerick: l,
    scavenger: s,
    cluehunt: c,
    quiz: q,
    // totals
    total,
    penalty,
    // returned flags used by the UI
    returnedAt,
    returned,
  };
}

exports.handler = async (event) => {
  try {
    const url = new URL(event.rawUrl || `https://${event.headers.host}${event.path}`);
    const eventId =
      url.searchParams.get("eventId") ||
      url.searchParams.get("event") ||
      ""; // keep flexible

    if (!eventId) return bad(400, "Missing eventId");

    // Pull team rows for this event
    const rows = await listTeamsByEventId(eventId);
    if (!Array.isArray(rows)) return ok({ leaderboard: [] });

    // Map and sort
    const leaderboard = rows
      .map(mapRowToTeam)
      .sort((a, b) => b.total - a.total || a.teamName.localeCompare(b.teamName));

    return ok({ eventId, leaderboard });
  } catch (e) {
    return bad(e.status || 500, e.message || "Error");
  }
};
