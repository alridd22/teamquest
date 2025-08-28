// get_leaderboard.js — CommonJS

const jwt = require("jsonwebtoken");
const {
  getSheets, readRange, ok, error, isPreflight,
  indexByHeader, tabRange, getStateMap, JWT_SECRET
} = require("./_utils.js");

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});

    // Optional: validate bearer token from team/admin pages
    const authz = event.headers.authorization || "";
    if (authz) {
      try {
        jwt.verify(authz.replace(/^Bearer\s+/i, ""), JWT_SECRET);
      } catch {
        /* ignore invalid tokens; endpoint remains public */
      }
    }

    const sheets = await getSheets();

    // Load sheets
    const [teamsVals, scoresVals, stateMap] = await Promise.all([
      readRange(sheets, null, tabRange("Teams", "A:E")),   // TeamID | Name | Pin | CheckedIn | ReturnedAt
      readRange(sheets, null, tabRange("Scores", "A:E")),  // TeamID | Activity | Points | Source | SubmissionID
      getStateMap(sheets),                                 // event_start, event_duration_minutes, checkins, published
    ]);

    const published = String(stateMap["published"]).toLowerCase() === "true";
    const checkinsStarted = String(stateMap["checkins"]).toLowerCase() === "true";
    const eventStart = stateMap["event_start"] ? new Date(stateMap["event_start"]) : null;
    const durationMin = stateMap["event_duration_minutes"]
      ? parseInt(stateMap["event_duration_minutes"], 10)
      : 90;

    const teams = indexByHeader(teamsVals);
    const scores = indexByHeader(scoresVals);

    // Aggregate scores per team
    const totals = {};
    scores.rows.forEach((r) => {
      const teamId   = r[scores.idx.TeamID];
      const activity = r[scores.idx.Activity];
      const pts      = parseFloat(r[scores.idx.Points] || "0") || 0;
      if (!teamId) return;
      if (!totals[teamId]) totals[teamId] = { base: 0, breakdown: {} };
      totals[teamId].base += pts;
      totals[teamId].breakdown[activity] = (totals[teamId].breakdown[activity] || 0) + pts;
    });

    // Build leaderboard rows
    const out = (teams.rows || []).map((r) => {
      const teamId       = r[teams.idx.TeamID];
      const name         = r[teams.idx.Name];
      const checkedIn    = String(r[teams.idx.CheckedIn] || "").toLowerCase() === "true";
      const returnedAtStr = r[teams.idx.ReturnedAt] || null;
      const t = totals[teamId] || { base: 0, breakdown: {} };

      // Late penalty: 1 pt/min after allotted time, if returned
      let latePenalty = 0;
      if (returnedAtStr && eventStart) {
        const returnedAt = new Date(returnedAtStr);
        const mins = (returnedAt - eventStart) / 60000;
        if (mins > durationMin) latePenalty = Math.floor(mins - durationMin);
      }

      const finalScore = Math.max(0, t.base - latePenalty);

      return {
        teamId,
        name,
        checkedIn,
        returnedAt: returnedAtStr,
        baseScore: t.base,
        breakdown: t.breakdown, // includes any admin penalty rows you add
        latePenalty,
        finalScore,
      };
    });

    // Sort: score desc, then earliest return, then name
    out.sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      if (a.returnedAt && b.returnedAt) return new Date(a.returnedAt) - new Date(b.returnedAt);
      if (a.returnedAt) return -1;
      if (b.returnedAt) return 1;
      return a.name.localeCompare(b.name);
    });

    return ok({ published, checkinsStarted, leaderboard: out });
  } catch (e) {
    console.error("get_leaderboard_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
