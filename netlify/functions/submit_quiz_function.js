// Submit quiz results — Google Sheets API version
const { ok, error, isPreflight, getSheets, SHEET_ID } = require("./_utils.js");

const SHEET_NAME = "Quiz";
const HEADERS = [
  "Team Code","Team Name","Total Score","Questions Correct","Total Questions",
  "Completion Time","Quiz Start Time","Duration (mins)","Percentage","Submission Time","Event Id"
];

async function ensureSheetExists(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some(s => s.properties?.title === SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] }
    });
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADERS] }
  });
}

function headerIndexMap(row0 = []) {
  const map = {};
  HEADERS.forEach((h, i) => (map[h] = i));
  row0.forEach((cell, i) => {
    const norm = String(cell || "").trim().toLowerCase();
    HEADERS.forEach(h => { if (norm === h.toLowerCase()) map[h] = i; });
  });
  return map;
}

function minsBetween(aISO, bISO) {
  try {
    const a = new Date(aISO).getTime(); const b = new Date(bISO).getTime();
    if (!isFinite(a) || !isFinite(b)) return "";
    return ((b - a) / 60000).toFixed(1);
  } catch { return ""; }
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch { return error(400, "Invalid JSON"); }

    const {
      eventId,
      teamCode, teamName,
      totalScore, questionsCorrect, totalQuestions,
      completionTime, quizStartTime
    } = body || {};

    if (!teamCode || totalScore == null) {
      return error(400, "teamCode and totalScore are required");
    }

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;
    if (!sheets) return error(500, "Spreadsheet client not available");

    await ensureSheetExists(sheets, spreadsheetId);

    const get = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A1:K`
    });
    const rows = get.data.values || [];
    const headers = rows[0] || HEADERS;
    const idx = headerIndexMap(headers);

    // Find row by team + event (if provided)
    let foundRow = -1;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const code = (row[idx["Team Code"]] || "").trim();
      const evt  = (row[idx["Event Id"]] || "").trim();
      if (code === teamCode && (!eventId || evt === eventId)) { foundRow = r; break; }
    }

    const nowISO = new Date().toISOString();
    const dur = minsBetween(quizStartTime, completionTime || nowISO);
    const pct = (totalQuestions ? ((Number(totalScore) / (Number(totalQuestions) * 10)) * 100).toFixed(0) : "");

    if (foundRow > 0) {
      const existing = rows[foundRow] || [];
      const out = new Array(HEADERS.length).fill("");
      HEADERS.forEach((h,i)=> out[i] = existing[idx[h]] ?? "");
      out[idx["Team Code"]] = teamCode;
      out[idx["Team Name"]] = teamName || existing[idx["Team Name"]] || "";
      out[idx["Total Score"]] = totalScore;
      out[idx["Questions Correct"]] = questionsCorrect ?? "";
      out[idx["Total Questions"]] = totalQuestions ?? "";
      out[idx["Completion Time"]] = completionTime || nowISO;
      out[idx["Duration (mins)"]] = dur;
      out[idx["Percentage"]] = pct;
      out[idx["Submission Time"]] = nowISO;
      if (eventId) out[idx["Event Id"]] = eventId;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAME}!A${foundRow+1}:K${foundRow+1}`,
        valueInputOption: "RAW",
        requestBody: { values: [out] }
      });
    } else {
      const out = new Array(HEADERS.length).fill("");
      out[idx["Team Code"]] = teamCode;
      out[idx["Team Name"]] = teamName || "";
      out[idx["Total Score"]] = totalScore;
      out[idx["Questions Correct"]] = questionsCorrect ?? "";
      out[idx["Total Questions"]] = totalQuestions ?? "";
      out[idx["Completion Time"]] = completionTime || nowISO;
      out[idx["Quiz Start Time"]] = quizStartTime || "";
      out[idx["Duration (mins)"]] = dur;
      out[idx["Percentage"]] = pct;
      out[idx["Submission Time"]] = nowISO;
      if (eventId) out[idx["Event Id"]] = eventId;

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${SHEET_NAME}!A1`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [out] }
      });
    }

    return ok({ success: true });
  } catch (e) {
    console.error("submit_quiz_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
