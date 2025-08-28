// check-clue-completion.js — CommonJS, uses shared utils

const {
  ok, error, isPreflight,
  getDoc, // should return an authenticated GoogleSpreadsheet
} = require("./_utils.js");

module.exports.handler = async (event) => {
  try {
    // CORS preflight
    if (isPreflight(event)) return ok({});

    // Only allow POST
    if (event.httpMethod !== "POST") return error(405, "Method not allowed");

    // Parse body
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return error(400, "Invalid JSON in request body");
    }
    const { teamCode } = body;
    if (!teamCode) return error(400, "teamCode is required");

    // Authenticated doc via shared utils (robust env/file fallback)
    const doc = await getDoc?.();
    if (!doc) return error(500, "Spreadsheet client not available");

    // Try common variants of the sheet title
    const titles = ["Clue Hunt", "CluHunt", "clue_hunt"];
    let clueHuntSheet = null;
    for (const t of titles) {
      if (doc.sheetsByTitle && doc.sheetsByTitle[t]) {
        clueHuntSheet = doc.sheetsByTitle[t];
        break;
      }
    }
    if (!clueHuntSheet) return error(404, "Clue Hunt sheet not found");

    // Load rows
    const rows = await clueHuntSheet.getRows();

    // Filter rows for this team (permit a few column name variants)
    const teamSubmissions = rows.filter((r) => {
      const v =
        r.get("Team Code") ||
        r.get("TeamCode") ||
        r.get("team_code") ||
        r.get("A") ||
        (r._rawData ? r._rawData[0] : null);
      return v && String(v).trim() === String(teamCode).trim();
    });

    // Compute totals
    let totalScore = 0;
    let correctAnswers = 0;
    for (const r of teamSubmissions) {
      const pts = parseInt(
        r.get("Points") ||
          r.get("Score") ||
          r.get("points") ||
          r.get("G") ||
          (r._rawData ? r._rawData[6] : 0) ||
          0,
        10
      );
      if (!isNaN(pts)) {
        totalScore += pts;
        if (pts > 0) correctAnswers += 1;
      }
    }

    // Completion rule
    const totalClues = 20;
    const attempted = teamSubmissions.length;
    const completed = attempted >= totalClues;

    return ok({
      success: true,
      completed,
      cluesAttempted: attempted,
      cluesCorrect: correctAnswers,
      totalClues,
      totalScore,
      progress: {
        attempted,
        correct: correctAnswers,
        total: totalClues,
        percentage: Math.round((attempted / totalClues) * 100),
      },
    });
  } catch (e) {
    console.error("check-clue-completion error:", e);
    const msg = e && e.message ? e.message : "Internal server error checking completion status";
    // Normalise a few common error types
    if (/not found/i.test(msg)) return error(404, "Sheet not found or inaccessible");
    if (/permission|403/i.test(msg)) return error(403, "Permission denied accessing spreadsheet");
    return error(500, msg);
  }
};
