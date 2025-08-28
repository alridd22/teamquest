// start_quiz.js — CommonJS, uses shared utils

const {
  ok, error, isPreflight,
  getDoc, // must be exported from _utils.js (GoogleSpreadsheet client)
} = require("./_utils.js");

module.exports.handler = async (event) => {
  console.log("Start Quiz request started at:", new Date().toISOString());

  try {
    // CORS preflight
    if (isPreflight(event)) return ok({ message: "CORS preflight successful" });

    // Only POST
    if (event.httpMethod !== "POST") {
      return error(405, "Method not allowed");
    }

    // Parse body
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return error(400, "Invalid JSON in request body");
    }

    const { teamCode, teamName, quizStartTime } = body || {};
    if (!teamCode || !teamName || !quizStartTime) {
      return error(400, "Missing required fields: teamCode, teamName, quizStartTime");
    }

    // Authenticated doc via shared utils (robust env/file fallback)
    const doc = await getDoc?.();
    if (!doc) return error(500, "Spreadsheet client not available");

    // Access the Quiz sheet
    const quizSheet = doc.sheetsByTitle ? doc.sheetsByTitle["Quiz"] : null;
    if (!quizSheet) {
      return error(
        500,
        "Quiz sheet not found. Please ensure the Quiz sheet exists in your Google Spreadsheet."
      );
    }

    // Load rows to check for duplicates
    await quizSheet.loadHeaderRow();
    const rows = await quizSheet.getRows();

    console.log("Checking for existing quiz record for team:", teamCode);
    const existingRow = rows.find((row) => row.get("Team Code") === teamCode);

    // Reject if already started
    if (existingRow && existingRow.get("Quiz Start Time")) {
      console.log("Team has already started quiz:", teamCode);
      return {
        statusCode: 409, // Conflict
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
        body: JSON.stringify({
          success: false,
          error: "Quiz already started",
          message: "This team has already started the quiz trial",
        }),
      };
    }

    // Record quiz start
    if (existingRow) {
      existingRow.set("Quiz Start Time", quizStartTime);
      existingRow.set("Team Name", teamName); // ensure team name is set/updated
      await existingRow.save();
      console.log("Updated existing row with quiz start time");
    } else {
      await quizSheet.addRow({
        "Team Code": teamCode,
        "Team Name": teamName,
        "Total Score": "",            // filled on completion
        "Questions Correct": "",
        "Total Questions": "",
        "Completion Time": "",
        "Quiz Start Time": quizStartTime,
        "Duration (mins)": "",
        "Percentage": "",
        "Submission Time": "",
      });
      console.log("Created new row with quiz start time");
    }

    console.log("Quiz start recorded successfully for team:", teamCode);
    return ok({
      success: true,
      message: "Quiz start recorded successfully",
      teamCode,
      startTime: quizStartTime,
    });
  } catch (e) {
    console.error("Start Quiz Function Error:", e);
    return error(500, "Internal server error", { details: e.message });
  }
};
