// get_scavenger.js — CommonJS, uses shared utils

const {
  ok, error, isPreflight,
  getDoc, // must be exported from _utils.js (GoogleSpreadsheet client)
} = require("./_utils.js");

module.exports.handler = async (event) => {
  console.log("Get scavenger submissions request started");

  try {
    // CORS preflight
    if (isPreflight(event)) return ok({});

    // Only POST
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

    // Pull submissions from Scavenger sheet
    const submissions = [];
    try {
      const scavengerSheet = doc.sheetsByTitle ? doc.sheetsByTitle["Scavenger"] : null;
      if (scavengerSheet) {
        await scavengerSheet.loadHeaderRow();
        const rows = await scavengerSheet.getRows();
        console.log("Scavenger rows loaded:", rows.length);

        const teamRows = rows.filter((row) => row.get("Team Code") === teamCode);
        console.log(`Found ${teamRows.length} submissions for team ${teamCode}`);

        for (const row of teamRows) {
          const itemId = row.get("Item ID");
          if (!itemId) continue;

          const aiScore = parseInt(row.get("AI Score"), 10) || 0;
          const verified = row.get("Verified");
          const submissionTime = row.get("Submission Time");

          // Consider it submitted if there's an AI Score OR if Verified column has any value
          const isSubmitted = aiScore > 0 || (verified && verified !== "Pending AI Verification");
          const isVerified = verified === "Verified" && aiScore > 0;

          submissions.push({
            itemId,
            score: aiScore,
            verified: isVerified,
            submitted: isSubmitted,
            submissionTime,
            verifiedStatus: verified,
          });
        }
      } else {
        console.log("Scavenger sheet not found");
      }
    } catch (e) {
      console.log("Error loading scavenger sheet:", e.message);
    }

    console.log("Returning submissions:", submissions.length);

    return ok({
      success: true,
      submissions,
      teamCode,
      timestamp: Date.now(),
    });
  } catch (e) {
    console.error("Get scavenger submissions error:", e);
    return error(500, e.message || "Unexpected error", { timestamp: Date.now() });
  }
};
