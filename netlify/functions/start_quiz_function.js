// netlify/functions/submit_quiz_function.js
// Writes quiz results straight to the "Quiz" sheet (no Zapier).
const { ok, error, isPreflight, getDoc } = require("./_utils.js");

// Ensure GoogleSpreadsheet "Quiz" sheet exists with expected headers
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

function parseISO(s) {
  const d = new Date(s);
  return isNaN(+d) ? null : d;
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});

    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return error(400, "Invalid JSON body"); }

    const {
      teamCode,
      teamName,
      totalScore,
      questionsCorrect,
      totalQuestions,
      quizStartTime,
      completionTime,
      // answers is optional; not stored in this simplified sheet
    } = body || {};

    // Basic validation
    if (!teamCode || !teamName) {
      return error(400, "teamCode and teamName are required");
    }
    if (
      typeof totalScore !== "number" ||
      typeof questionsCorrect !== "number" ||
      typeof totalQuestions !== "number"
    ) {
      return error(400, "totalScore, questionsCorrect, totalQuestions must be numbers");
    }

    const startDt = parseISO(quizStartTime) || new Date();
    const endDt = parseISO(completionTime) || new Date();
    const durationMins = Math.max(0, Math.round((endDt - startDt) / 60000));
    const percentage = totalQuestions > 0
      ? Math.round((questionsCorrect / totalQuestions) * 100)
      : 0;
    const submittedAt = new Date().toISOString();

    // Open doc and ensure sheet
    const doc = await getDoc?.();
    if (!doc) return error(500, "Spreadsheet client not available");

    const sheet = await ensureQuizSheet(doc);

    // Find existing row for this team (single-attempt model)
    const rows = await sheet.getRows({ limit: 10000 });
    const existing = rows.find(r => r.get("Team Code") === teamCode);

    if (existing) {
      existing.set("Team Name", teamName);
      existing.set("Total Score", String(totalScore));
      existing.set("Questions Correct", String(questionsCorrect));
      existing.set("Total Questions", String(totalQuestions));
      existing.set("Quiz Start Time", startDt.toISOString());
      existing.set("Completion Time", endDt.toISOString());
      existing.set("Duration (mins)", String(durationMins));
      existing.set("Percentage", String(percentage));
      existing.set("Submission Time", submittedAt);
      await existing.save();
    } else {
      await sheet.addRow({
        "Team Code": teamCode,
        "Team Name": teamName,
        "Total Score": String(totalScore),
        "Questions Correct": String(questionsCorrect),
        "Total Questions": String(totalQuestions),
        "Quiz Start Time": startDt.toISOString(),
        "Completion Time": endDt.toISOString(),
        "Duration (mins)": String(durationMins),
        "Percentage": String(percentage),
        "Submission Time": submittedAt
      });
    }

    return ok({
      success: true,
      message: "Quiz submission recorded",
      teamCode,
      teamName,
      totalScore,
      questionsCorrect,
      totalQuestions,
      durationMins,
      percentage
    });
  } catch (e) {
    console.error("submit_quiz_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
