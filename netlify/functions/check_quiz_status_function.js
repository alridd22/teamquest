// netlify/functions/check_quiz_status_function.js
const { ok, error, isPreflight, getDoc } = require("./_utils.js");

async function ensureQuizSheet(doc) {
  const headers = [
    "Team Code","Team Name","Total Score","Questions Correct","Total Questions",
    "Quiz Start Time","Completion Time","Duration (mins)","Percentage","Submission Time"
  ];
  await doc.loadInfo();
  let sheet = doc.sheetsByTitle["Quiz"];
  if (!sheet) return await doc.addSheet({ title: "Quiz", headerValues: headers });
  await sheet.loadHeaderRow();
  const cur = sheet.headerValues || [];
  const needReset = headers.length !== cur.length || headers.some((h,i)=> (cur[i]||"").trim()!==h);
  if (needReset) await sheet.setHeaderRow(headers);
  return sheet;
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch { return error(400, "Invalid JSON"); }
    const { teamCode } = body || {};
    if (!teamCode) return error(400, "teamCode required");

    const doc = await getDoc?.();
    if (!doc) return error(500, "Spreadsheet client not available");

    const sheet = await ensureQuizSheet(doc);
    const rows = await sheet.getRows({ limit: 10000 });
    const row = rows.find(r => r.get("Team Code") === teamCode);

    const started   = !!(row && row.get("Quiz Start Time"));
    const completed = !!(row && row.get("Completion Time"));

    return ok({ success: true, started, completed });
  } catch (e) {
    console.error("check_quiz_status_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
