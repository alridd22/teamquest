// submit_kindness.js — CommonJS, uses shared utils

const {
  ok, error, isPreflight,
  getDoc, // exported from _utils.js: returns authenticated GoogleSpreadsheet
} = require("./_utils.js");

module.exports.handler = async (event) => {
  console.log("Kindness submission started");

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

    const { teamCode, teamName, description, location, photoUrl } = body;
    if (!teamCode || !teamName || !description || !photoUrl) {
      return error(400, "Missing required fields");
    }

    // Authenticated doc via shared utils (robust env/file fallback)
    const doc = await getDoc?.();
    if (!doc) return error(500, "Spreadsheet client not available");

    // Find or create the Kindness sheet
    let kindnessSheet = doc.sheetsByTitle ? doc.sheetsByTitle["Kindness"] : null;

    if (!kindnessSheet) {
      console.log("Kindness sheet not found, creating it");
      kindnessSheet = await doc.addSheet({
        title: "Kindness",
        headerValues: [
          "Team Code",
          "Team Name",
          "Description",
          "Location",
          "Photo Status",
          "Submission Time",
          "AI Score",
        ],
      });
    } else {
      await kindnessSheet.loadHeaderRow();
      if (!kindnessSheet.headerValues || kindnessSheet.headerValues.length === 0) {
        console.log("Setting Kindness sheet headers");
        await kindnessSheet.setHeaderRow([
          "Team Code",
          "Team Name",
          "Description",
          "Location",
          "Photo Status",
          "Submission Time",
          "AI Score",
        ]);
        await kindnessSheet.loadHeaderRow();
      }
    }

    // Add the submission
    const submissionTime = new Date().toISOString();
    const newRow = await kindnessSheet.addRow({
      "Team Code": teamCode,
      "Team Name": teamName,
      "Description": description,
      "Location": location || "",
      "Photo Status": photoUrl,      // store the actual photo URL here (as you designed)
      "Submission Time": submissionTime,
      "AI Score": "Pending AI Score" // AI scoring handled elsewhere (e.g., Apps Script / Sheet trigger)
    });

    console.log("Kindness submission saved:", newRow.rowNumber);

    // Return success (AI scoring message kept)
    const estimatedScore = "Will be scored by AI within 1-2 minutes";
    return ok({
      success: true,
      message:
        "Kindness act submitted successfully! AI will score your submission within 1-2 minutes.",
      estimatedScore,
      teamCode,
      teamName,
      photoUrl,
    });
  } catch (e) {
    console.error("Kindness submission error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
