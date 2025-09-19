// netlify/functions/start_quiz_function.js
// Records the quiz "start" and prevents restarts. No Zapier needed.
const { ok, error, isPreflight, getDoc } = require("./_utils.js");

async function ensureQuizSheet(doc) {
  const headers = [
    "Team Code",
    "Team Name",
    "Total Score",
    "Questions Correct",
    "Total Questions",
    "Quiz Start Time",
    "Completion Time",
    "Duration (mins)",
    "Percentage",
    "Submission Time"
  ];

  await doc.loadInfo();
  let sheet = doc.sheetsByTitle["Quiz"];
  if (!sheet) {
    sheet = await doc.addSheet({ title: "Quiz", headerValues: headers });
    return sheet;
  }
  await sheet.loadHeaderRow();
  const cur = sheet.headerValues || [];
  const needReset =
    headers.length !== cur.length ||
    headers.some((h, i) => (cur[i] || "").trim() !== h);
  if (needReset) await sheet.setHeaderRow(headers);
  return sheet;
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return error(400, "Invalid JSON body"); }

    const { teamCode, teamName, quizStartTime } = body || {};
    if (!teamCode || !teamName || !quizStartTime) {
      return error(400, "teamCode, teamName and quizStartTime are required");
    }

    const doc = await getDoc?.();
    if (!doc) return error(500, "Spreadsheet client not available");

    const sheet = await ensureQuizSheet(doc);

    // Single attempt per team (per sheet). If row exists with a start time, block.
    const rows = await sheet.getRows({ limit: 10000 });
    const existing = rows.find(r => r.get("Team Code") === teamCode);

    if (existing && existing.get("Quiz Start Time")) {
      return {
        statusCode: 409,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
        body: JSON.stringify({
          success: false,
          error: "Quiz already started",
          started: true,
          completed: !!existing.get("Completion Time")
        })
      };
    }

    if (existing) {
      existing.set("Team Name", teamName);
      existing.set("Quiz Start Time", new Date(quizStartTime).toISOString());
      await existing.save();
    } else {
      await sheet.addRow({
        "Team Code": teamCode,
        "Team Name": teamName,
        "Total Score": "",
        "Questions Correct": "",
        "Total Questions": "",
        "Quiz Start Time": new Date(quizStartTime).toISOString(),
        "Completion Time": "",
        "Duration (mins)": "",
        "Percentage": "",
        "Submission Time": ""
      });
    }

    return ok({ success: true, message: "Quiz start recorded" });
  } catch (e) {
    console.error("start_quiz_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
