// submit_scavenger.js — CommonJS, uses shared utils

const {
  ok, error, isPreflight,
  getDoc, // exported from _utils.js: returns an authenticated GoogleSpreadsheet
} = require("./_utils.js");

module.exports.handler = async (event) => {
  console.log("Scavenger item submission started");

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
      itemId,
      itemTitle,
      itemDescription,
      photoUrl,
      maxPoints,
    } = body;

    if (!teamCode || !teamName || !itemId || !itemTitle || !photoUrl) {
      return error(400, "Missing required fields");
    }

    // Authenticated doc via shared utils (robust env/file fallback)
    const doc = await getDoc?.();
    if (!doc) return error(500, "Spreadsheet client not available");

    // Find or create the Scavenger sheet
    let scavengerSheet = doc.sheetsByTitle ? doc.sheetsByTitle["Scavenger"] : null;

    if (!scavengerSheet) {
      console.log("Scavenger sheet not found, creating it with headers");
      scavengerSheet = await doc.addSheet({
        title: "Scavenger",
        headerValues: [
          "Team Code",
          "Team Name",
          "Item ID",
          "Item Title",
          "Item Description",
          "Photo URL",
          "Max Points",
          "Submission Time",
          "AI Score",
          "Verified",
        ],
      });
    } else {
      await scavengerSheet.loadHeaderRow();
      const needHeaders =
        !scavengerSheet.headerValues || scavengerSheet.headerValues.length === 0;
      if (needHeaders) {
        console.log("No headers found, setting headers via setHeaderRow");
        await scavengerSheet.setHeaderRow([
          "Team Code",
          "Team Name",
          "Item ID",
          "Item Title",
          "Item Description",
          "Photo URL",
          "Max Points",
          "Submission Time",
          "AI Score",
          "Verified",
        ]);
        await scavengerSheet.loadHeaderRow();
      }
    }

    // Add submission
    const submissionTime = new Date().toISOString();
    const newRow = await scavengerSheet.addRow({
      "Team Code": teamCode,
      "Team Name": teamName,
      "Item ID": itemId,
      "Item Title": itemTitle,
      "Item Description": itemDescription || "",
      "Photo URL": photoUrl,
      "Max Points": maxPoints || 10,
      "Submission Time": submissionTime,
      "AI Score": "Pending AI Verification",
      "Verified": "Pending",
    });

    console.log("Scavenger item saved at row:", newRow.rowNumber);

    // Mirror your original success payload
    return ok({
      success: true,
      message: `${itemTitle} submitted successfully! AI is now analyzing your photo...`,
      verified: false, // Until actual AI verification occurs
      score: 0,        // Until AI scoring occurs
      status: "pending_verification",
      teamCode,
      teamName,
      itemTitle,
      submissionTime,
      note:
        "Check back in 1-2 minutes for AI verification results, or refresh the leaderboard to see updated scores.",
    });
  } catch (e) {
    console.error("Scavenger submission error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
