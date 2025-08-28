// cluehunt_submissions.js — CommonJS, uses shared utils

const {
  ok, error, isPreflight,
  getDoc, // must be exported from _utils.js
} = require("./_utils.js");

module.exports.handler = async (event) => {
  console.log("Get clue hunt submissions request started");

  try {
    // CORS preflight
    if (isPreflight(event)) return ok({});

    // Only POST (optional; keep permissive if you want)
    if (event.httpMethod !== "POST") return error(405, "POST only");

    // Parse body
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return error(400, "Invalid JSON");
    }
    const { teamCode } = body;
    if (!teamCode) return error(400, "Team code is required");

    // Authenticated doc via shared utils (robust env/file fallback)
    const doc = await getDoc?.();
    if (!doc) return error(500, "Spreadsheet client not available");

    // Find the Clue Hunt sheet (exact title like before)
    const clueHuntSheet = doc.sheetsByTitle ? doc.sheetsByTitle["Clue Hunt"] : null;
    const submissions = [];
    let totalScore = 0;

    if (clueHuntSheet) {
      await clueHuntSheet.loadHeaderRow();
      const rows = await clueHuntSheet.getRows();
      console.log("Clue Hunt rows loaded:", rows.length);

      const teamRows = rows.filter((row) => row.get("Team Code") === teamCode);
      console.log(`Found ${teamRows.length} clue attempts for team ${teamCode}`);

      for (const row of teamRows) {
        const clueId = parseInt(row.get("Clue ID"), 10);
        if (!Number.isFinite(clueId)) continue;

        const userAnswer = row.get("User Answer");
        const correctAnswer = row.get("Correct Answer");
        const points = parseInt(row.get("Points"), 10) || 0;
        const wasCorrect =
          row.get("Was Correct") === "true" ||
          row.get("Was Correct") === true;
        const attemptTime = row.get("Timestamp");

        submissions.push({
          clueId,
          userAnswer,
          correctAnswer,
          points,
          wasCorrect,
          attemptTime,
        });

        if (wasCorrect && points > 0) totalScore += points;
      }
    } else {
      console.log('Clue Hunt sheet not found');
    }

    console.log(
      `Team ${teamCode} - Total clue attempts: ${submissions.length}, Total score: ${totalScore}`
    );

    return ok({
      success: true,
      submissions,
      totalScore,
      teamCode,
      timestamp: Date.now(),
    });
  } catch (e) {
    console.error("Get clue hunt submissions error:", e);
    return error(500, e.message || "Unexpected error", { timestamp: Date.now() });
  }
};
