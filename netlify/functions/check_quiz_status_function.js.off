// check-quiz-status.js — CommonJS, uses shared utils

const {
  ok, error, isPreflight,
  getDoc, // must be exported from _utils.js
} = require("./_utils.js");

module.exports.handler = async (event) => {
  console.log("Check Quiz Status request started at:", new Date().toISOString());

  try {
    // CORS preflight
    if (isPreflight(event)) return ok({});

    // Only POST allowed
    if (event.httpMethod !== "POST") return error(405, "Method not allowed");

    // Parse body
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return error(400, "Invalid JSON in request body");
    }
    const { teamCode } = body;
    if (!teamCode) return error(400, "Missing required field: teamCode");

    // Authenticated spreadsheet via shared utils (robust env/file fallback)
    const doc = await getDoc?.();
    if (!doc) {
      // Align with your current behaviour: treat as "not started"
      console.log("Spreadsheet client unavailable — treating as not started");
      return ok({
        success: true,
        started: false,
        completed: false,
        message: "Spreadsheet unavailable — quiz not started",
      });
    }

    // Access the Quiz sheet
    const quizSheet = doc.sheetsByTitle ? doc.sheetsByTitle["Quiz"] : null;
    if (!quizSheet) {
      console.log("Quiz sheet not found — treating as not started");
      return ok({
        success: true,
        started: false,
        completed: false,
        message: "Quiz sheet not found — quiz not started",
      });
    }

    // Load data
    await quizSheet.loadHeaderRow();
    const rows = await quizSheet.getRows();

    console.log("Checking quiz status for team:", teamCode);

    // Find the team’s record
    const row = rows.find((r) => r.get("Team Code") === teamCode);
    if (!row) {
      console.log("No quiz record found for team:", teamCode);
      return ok({
        success: true,
        started: false,
        completed: false,
        message: "No quiz record found",
      });
    }

    // Determine status from fields
    const startVal = row.get("Quiz Start Time");
    const doneVal  = row.get("Completion Time");

    const hasStartTime      = !!(startVal && String(startVal).trim());
    const hasCompletionTime = !!(doneVal && String(doneVal).trim());

    console.log("Quiz status:", {
      teamCode,
      hasStartTime,
      hasCompletionTime,
      startTime: startVal,
      completionTime: doneVal,
    });

    return ok({
      success: true,
      started: hasStartTime,
      completed: hasCompletionTime,
      teamCode,
      quizStartTime: hasStartTime ? startVal : null,
      completionTime: hasCompletionTime ? doneVal : null,
      totalScore: hasCompletionTime ? (row.get("Total Score") || "0") : null,
    });
  } catch (e) {
    console.error("Check Quiz Status error:", e);
    return error(500, "Internal server error", { details: e.message });
  }
};
