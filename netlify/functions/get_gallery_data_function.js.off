// get_gallery_data.js — CommonJS, uses shared utils

const {
  ok, error, isPreflight,
  getDoc, // must be exported from _utils.js (GoogleSpreadsheet client)
} = require("./_utils.js");

module.exports.handler = async (event) => {
  console.log("Gallery data request started");

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
      return error(400, "Invalid JSON body");
    }

    const { type } = body;
    if (!type || !["kindness", "limerick"].includes(type)) {
      return error(400, "Invalid or missing type parameter");
    }

    console.log("Loading gallery data for type:", type);

    // Authenticated doc via shared utils (robust env/file fallback)
    const doc = await getDoc?.();
    if (!doc) return error(500, "Spreadsheet client not available");

    let submissions = [];

    if (type === "kindness") {
      try {
        const kindnessSheet = doc.sheetsByTitle ? doc.sheetsByTitle["Kindness"] : null;
        if (kindnessSheet) {
          await kindnessSheet.loadHeaderRow();
          const rows = await kindnessSheet.getRows();
          console.log("Kindness rows loaded:", rows.length);

          submissions = rows
            .map((row) => ({
              teamCode: row.get("Team Code"),
              teamName: row.get("Team Name"),
              description: row.get("Description"),
              // Your data uses "Photo Status" to hold a URL (per your original code)
              photoUrl: row.get("Photo Status"),
              aiScore: row.get("AI Score"),
              verified: row.get("Verified"),
              submissionTime: row.get("Submission Time"),
            }))
            .filter(
              (item) =>
                item.teamCode &&
                item.teamName &&
                item.description &&
                item.photoUrl &&
                item.submissionTime &&
                String(item.photoUrl).startsWith("https://")
            )
            .sort(
              (a, b) => new Date(b.submissionTime).valueOf() - new Date(a.submissionTime).valueOf()
            );
        } else {
          console.log("Kindness sheet not found");
        }
      } catch (e) {
        console.log("Kindness sheet error:", e.message);
      }
    } else if (type === "limerick") {
      try {
        const limerickSheet = doc.sheetsByTitle ? doc.sheetsByTitle["Limerick"] : null;
        if (limerickSheet) {
          await limerickSheet.loadHeaderRow();
          const rows = await limerickSheet.getRows();
          console.log("Limerick rows loaded:", rows.length);

          submissions = rows
            .map((row) => ({
              teamCode: row.get("Team Code"),
              teamName: row.get("Team Name"),
              topic: row.get("Topic"),
              limerickText: row.get("Limerick Text"),
              rhymePattern: row.get("Rhyme Pattern"),
              aiScore: row.get("AI Score"),
              verified: row.get("Verified"),
              submissionTime: row.get("Submission Time"),
            }))
            .filter(
              (item) =>
                item.teamCode &&
                item.teamName &&
                item.topic &&
                item.limerickText &&
                item.submissionTime
            )
            .sort(
              (a, b) => new Date(b.submissionTime).valueOf() - new Date(a.submissionTime).valueOf()
            );
        } else {
          console.log("Limerick sheet not found");
        }
      } catch (e) {
        console.log("Limerick sheet error:", e.message);
      }
    }

    console.log("Gallery data loaded:", { type, submissionCount: submissions.length });

    return ok({
      success: true,
      type,
      submissions,
      count: submissions.length,
      lastUpdated: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Gallery data error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
