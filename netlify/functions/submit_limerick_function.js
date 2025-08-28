// submit_limerick.js — CommonJS, uses shared utils

const {
  ok, error, isPreflight,
  getDoc, // exported from _utils.js: returns an authenticated GoogleSpreadsheet
} = require("./_utils.js");

module.exports.handler = async (event) => {
  console.log("Limerick submission started");

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

    const { teamCode, teamName, topic, limerickText } = body;
    if (!teamCode || !teamName || !limerickText) {
      return error(400, "Missing required fields");
    }

    // Authenticated doc via shared utils (robust env/file fallback)
    const doc = await getDoc?.();
    if (!doc) return error(500, "Spreadsheet client not available");

    // Find or create the Limerick sheet
    let limerickSheet = doc.sheetsByTitle ? doc.sheetsByTitle["Limerick"] : null;

    if (!limerickSheet) {
      console.log("Limerick sheet not found, creating it");
      limerickSheet = await doc.addSheet({
        title: "Limerick",
        headerValues: [
          "Team Code",
          "Team Name",
          "Topic",
          "Limerick Text",
          "Submission Time",
          "AI Score",
        ],
      });
    } else {
      await limerickSheet.loadHeaderRow();
      if (!limerickSheet.headerValues || limerickSheet.headerValues.length === 0) {
        console.log("Setting Limerick sheet headers");
        await limerickSheet.setHeaderRow([
          "Team Code",
          "Team Name",
          "Topic",
          "Limerick Text",
          "Submission Time",
          "AI Score",
        ]);
        await limerickSheet.loadHeaderRow();
      }
    }

    // Add the submission
    const submissionTime = new Date().toISOString();
    const newRow = await limerickSheet.addRow({
      "Team Code": teamCode,
      "Team Name": teamName,
      "Topic": topic || "No topic specified",
      "Limerick Text": limerickText,
      "Submission Time": submissionTime,
      "AI Score": "Pending AI Score",
    });

    console.log("Limerick submission saved:", newRow.rowNumber);

    // Mirror your original success payload
    const estimatedScore = "Will be scored by AI within 1-2 minutes";
    return ok({
      success: true,
      message:
        "Limerick submitted successfully! AI will score your submission within 1-2 minutes.",
      estimatedScore,
      teamCode,
      teamName,
    });
  } catch (e) {
    console.error("Limerick submission error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
