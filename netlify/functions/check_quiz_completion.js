// check-quiz-completion.js — CommonJS, uses shared utils

const {
  ok, error, isPreflight,
  getDoc, // exported from _utils.js to return an authenticated GoogleSpreadsheet
} = require("./_utils.js");

module.exports.handler = async (event) => {
  console.log("Quiz completion check started");

  try {
    // CORS preflight
    if (isPreflight(event)) return ok({});

    // Only POST allowed
    if (event.httpMethod !== "POST") return error(405, "Method not allowed");

    // Parse body
    let payload = {};
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      // Be permissive: allow quiz if header/body is malformed (fail-safe)
      return ok({
        success: true,
        completed: false,
        message: "Invalid JSON; allowing quiz",
      });
    }
    const { teamCode } = payload;
    if (!teamCode) {
      return ok({
        success: true,
        completed: false,
        message: "teamCode missing; allowing quiz",
      });
    }

    // Get authenticated spreadsheet doc via utils (robust env/file fallback)
    const doc = await getDoc?.();
    if (!doc) {
      console.log("No spreadsheet client; allowing quiz");
      return ok({
        success: true,
        completed: false,
        message: "Spreadsheet not available; allowing quiz",
      });
    }

    // Find "Quiz" sheet (case-sensitive match like original)
    let quizSheet = null;
    if (doc.sheetsByTitle && doc.sheetsByTitle["Quiz"]) {
      quizSheet = doc.sheetsByTitle["Quiz"];
    }
    if (!quizSheet) {
      console.log("Quiz sheet not found; allowing quiz");
      return ok({
        success: true,
        completed: false,
        message: "Quiz sheet not found; allowing quiz",
      });
    }

    // Load headers & rows
    await quizSheet.loadHeaderRow();
    const rows = await quizSheet.getRows();

    // Existing submission?
    const existing = rows.find((row) => row.get("Team Code") === teamCode);
    const hasCompleted = !!existing;

    console.log("Quiz completion check result:", {
      teamCode,
      hasCompleted,
      existingScore: existing ? existing.get("Total Score") : "N/A",
    });

    return ok({
      success: true,
      completed: hasCompleted,
      teamCode,
      existingScore: existing ? existing.get("Total Score") : null,
      existingCorrect: existing ? existing.get("Questions Correct") : null,
      existingTotal: existing ? existing.get("Total Questions") : null,
      message: hasCompleted
        ? "Team has already completed the quiz"
        : "Team can take the quiz",
    });
  } catch (err) {
    console.error("Quiz completion check error:", err);
    // Fail-safe: allow quiz to proceed on any error
    return ok({
      success: true,
      completed: false,
      message: "Check failed, allowing quiz to proceed",
    });
  }
};
