// submit_cluehunt.js — CommonJS, uses shared utils

const {
  ok, error, isPreflight,
  getDoc, // must be exported from _utils.js (GoogleSpreadsheet client)
} = require("./_utils.js");

module.exports.handler = async (event) => {
  console.log("Clue Hunt submission started");

  try {
    // CORS preflight
    if (isPreflight(event)) return ok({});

    // Only POST
    if (event.httpMethod !== "POST") return error(405, "Method not allowed");

    // Parse body
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return error(400, "Invalid JSON body");
    }

    const {
      teamCode,
      teamName,
      clueId,
      clueText,
      userAnswer,
      correctAnswer,
      points,
      currentScore,
    } = body;

    // Fix validation: points may be 0; check for undefined/null explicitly
    if (!teamCode || !teamName || !clueId || !userAnswer || points === undefined || points === null) {
      return error(400, "Missing required clue hunt submission fields");
    }

    // Authenticated doc via shared utils (robust env/file fallback)
    const doc = await getDoc?.();
    if (!doc) return error(500, "Spreadsheet client not available");

    // Find or create the "Clue Hunt" sheet
    let clueHuntSheet = doc.sheetsByTitle ? doc.sheetsByTitle["Clue Hunt"] : null;

    if (!clueHuntSheet) {
      console.log("Clue Hunt sheet not found, creating it with headers");
      clueHuntSheet = await doc.addSheet({
        title: "Clue Hunt",
        headerValues: [
          "Team Code",
          "Team Name",
          "Clue ID",
          "Clue Text",
          "User Answer",
          "Correct Answer",
          "Points",
          "Current Score",
          "Submission Time",
        ],
      });
      console.log("Clue Hunt sheet created successfully");
    } else {
      await clueHuntSheet.loadHeaderRow();
      const needHeaders =
        !clueHuntSheet.headerValues || clueHuntSheet.headerValues.length === 0;
      if (needHeaders) {
        console.log("No headers found, setting up headers");
        await clueHuntSheet.setHeaderRow([
          "Team Code",
          "Team Name",
          "Clue ID",
          "Clue Text",
          "User Answer",
          "Correct Answer",
          "Points",
          "Current Score",
          "Submission Time",
        ]);
        await clueHuntSheet.loadHeaderRow();
      }
    }

    // Check for duplicate submission (same team + clue)
    await clueHuntSheet.loadHeaderRow();
    const existingRows = await clueHuntSheet.getRows();
    const existingSubmission = existingRows.find(
      (row) =>
        row.get("Team Code") === String(teamCode) &&
        String(row.get("Clue ID")) === String(clueId)
    );

    if (existingSubmission) {
      console.log("Clue already submitted by this team, skipping duplicate");
      return ok({
        success: true,
        message: "Clue already completed",
        duplicate: true,
        teamCode,
        clueId,
        points,
      });
    }

    const submissionTime = new Date().toISOString();

    console.log("Adding clue hunt submission", {
      teamCode,
      teamName,
      clueId,
      points,
      currentScore,
    });

    // Add the clue submission
    const newRow = await clueHuntSheet.addRow({
      "Team Code": teamCode,
      "Team Name": teamName,
      "Clue ID": clueId,
      "Clue Text": clueText,
      "User Answer": userAnswer,
      "Correct Answer": correctAnswer,
      "Points": points,
      "Current Score": currentScore,
      "Submission Time": submissionTime,
    });

    console.log("Clue hunt submission saved to row:", newRow.rowNumber);

    return ok({
      success: true,
      message: `Clue ${clueId} completed! ${points} points earned.`,
      teamCode,
      teamName,
      clueId,
      points,
      currentScore,
      submissionTime,
    });
  } catch (e) {
    console.error("Clue hunt submission error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
