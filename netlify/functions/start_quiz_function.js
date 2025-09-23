// Start the quiz — Google Sheets API version (matches scavenger utils)
const { ok, error, isPreflight, getSheets, SHEET_ID } = require("./_utils.js");

const SHEET_NAME = "Quiz";
const HEADERS = [
  "Team Code",        // A
  "Team Name",        // B
  "Total Score",      // C
  "Questions Correct",// D
  "Total Questions",  // E
  "Completion Time",  // F
  "Quiz Start Time",  // G
  "Duration (mins)",  // H
  "Percentage",       // I
  "Submission Time",  // J
  "Event Id"          // K
];

async function ensureSheetExists(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || [])
    .some(s => s.properties?.title === SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] }
    });
  }
  // Always ensure headers present in row 1
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
  // tolerate capitalisation drift
  row0.forEach((cell, i) => {
    const norm = String(cell || "").trim().toLowerCase();
    HEADERS.forEach(h => {
      if (norm && norm === h.toLowerCase()) map[h] = i;
    });
  });
  return map;
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch { return error(400, "Invalid JSON"); }

    const { eventId, teamCode, teamName, quizStartTime } = body || {};
    if (!teamCode || !teamName || !quizStartTime) {
      return error(400, "Missing required fields: teamCode, teamName, quizStartTime");
    }

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;
    if (!sheets) return error(500, "Spreadsheet client not available");

    await ensureSheetExists(sheets, spreadsheetId);

    // Read current rows
    const get = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A1:K`
    });
    const rows = get.data.values || [];
    const headers = rows[0] || HEADERS;
    const idx = headerIndexMap(headers);

    // Find row for this team (and event, if provided)
    let foundRow = -1;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const code = (row[idx["Team Code"]] || "").trim();
      const evt  = (row[idx["Event Id"]] || "").trim();
      if (code === teamCode && (!eventId || evt === eventId)) {
        foundRow = r;
        break;
      }
    }

    // If row exists and already has a start time, block re-start
    if (foundRow > 0) {
      const hasStart = (rows[foundRow][idx["Quiz Start Time"]] || "").trim();
      if (hasStart) {
        return {
          statusCode: 409,
          headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
          body: JSON.stringify({ success: false, error: "Quiz already started" })
        };
      }
    }

    if (foundRow > 0) {
      // Update existing row with start time + team info
      const existing = rows[foundRow] || [];
      const out = new Array(HEADERS.length).fill("");
      HEADERS.forEach((h, i) => out[i] = existing[idx[h]] ?? "");
      out[idx["Team Code"]] = teamCode;
      out[idx["Team Name"]] = teamName;
      out[idx["Quiz Start Time"]] = quizStartTime;
      if (eventId) out[idx["Event Id"]] = eventId;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAME}!A${foundRow + 1}:K${foundRow + 1}`,
        valueInputOption: "RAW",
        requestBody: { values: [out] }
      });
    } else {
      // Append a fresh row
      const out = new Array(HEADERS.length).fill("");
      out[idx["Team Code"]] = teamCode;
      out[idx["Team Name"]] = teamName;
      out[idx["Quiz Start Time"]] = quizStartTime;
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
    console.error("start_quiz_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
