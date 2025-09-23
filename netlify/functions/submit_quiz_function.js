// Submit quiz results — write to Quiz sheet AND to submissions for leaderboard
const { ok, error, isPreflight, getSheets, SHEET_ID } = require("./_utils.js");

// ---- Sheet names & headers ----
const QUIZ_SHEET = "Quiz";
const QUIZ_HEADERS = [
  "Team Code","Team Name","Total Score","Questions Correct","Total Questions",
  "Completion Time","Quiz Start Time","Duration (mins)","Percentage","Submission Time","Event Id"
];

// This is the same structure your other activities use
const SUBMISSIONS_SHEET = "submissions";
const SUBM_HEADERS = [
  "Timestamp",     // A
  "Team Code",     // B
  "Activity",      // C
  "Nonce",         // D
  "Payload",       // E (JSON)
  "AI Status",     // F
  "AI Attempts",   // G
  "AI Score",      // H
  "Final Score",   // I
  "Idempotency",   // J
  "Event Id"       // K
];

// ---- helpers ----
async function ensureSheetWithHeaders(sheets, spreadsheetId, title, headers) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some(s => s.properties?.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] }
    });
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${title}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers] }
  });
}

function indexMap(headersWanted, row0 = []) {
  const map = {};
  headersWanted.forEach((h, i) => (map[h] = i));
  row0.forEach((cell, i) => {
    const norm = String(cell || "").trim().toLowerCase();
    headersWanted.forEach(h => {
      if (norm === h.toLowerCase()) map[h] = i;
    });
  });
  return map;
}

function minsBetween(aISO, bISO) {
  try {
    const a = new Date(aISO).getTime();
    const b = new Date(bISO).getTime();
    if (!isFinite(a) || !isFinite(b)) return "";
    return ((b - a) / 60000).toFixed(1);
  } catch { return ""; }
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return error(400, "Invalid JSON"); }

    // From the page
    const {
      teamCode,
      teamName,
      totalScore,
      questionsCorrect,
      totalQuestions,
      completionTime,
      quizStartTime,
      answers,         // optional; we include in payload JSON
      eventId          // optional (include if you can)
    } = body || {};

    if (!teamCode || totalScore == null) {
      return error(400, "teamCode and totalScore are required");
    }

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;
    if (!sheets) return error(500, "Spreadsheet client not available");

    // Ensure both sheets exist & have headers
    await ensureSheetWithHeaders(sheets, spreadsheetId, QUIZ_SHEET, QUIZ_HEADERS);
    await ensureSheetWithHeaders(sheets, spreadsheetId, SUBMISSIONS_SHEET, SUBM_HEADERS);

    // ---------- Upsert into QUIZ sheet ----------
    const nowISO = new Date().toISOString();
    const getQuiz = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${QUIZ_SHEET}!A1:K`
    });
    const quizRows = getQuiz.data.values || [];
    const quizHdr = quizRows[0] || QUIZ_HEADERS;
    const qi = indexMap(QUIZ_HEADERS, quizHdr);

    const duration = minsBetween(quizStartTime, completionTime || nowISO);
    const percent = (totalQuestions ? ((Number(totalScore) / (Number(totalQuestions) * 10)) * 100).toFixed(0) : "");

    // find row by team + (optional) event
    let quizRowIdx = -1;
    for (let r = 1; r < quizRows.length; r++) {
      const row = quizRows[r] || [];
      const code = (row[qi["Team Code"]] || "").trim();
      const evt  = (row[qi["Event Id"]] || "").trim();
      if (code === teamCode && (!eventId || evt === eventId)) { quizRowIdx = r; break; }
    }

    if (quizRowIdx > 0) {
      // Update
      const existing = quizRows[quizRowIdx] || [];
      const out = new Array(QUIZ_HEADERS.length).fill("");
      QUIZ_HEADERS.forEach((h, i) => out[i] = existing[qi[h]] ?? "");
      out[qi["Team Code"]]         = teamCode;
      out[qi["Team Name"]]         = teamName || existing[qi["Team Name"]] || "";
      out[qi["Total Score"]]       = totalScore;
      out[qi["Questions Correct"]] = questionsCorrect ?? "";
      out[qi["Total Questions"]]   = totalQuestions ?? "";
      out[qi["Completion Time"]]   = completionTime || nowISO;
      out[qi["Quiz Start Time"]]   = quizStartTime || existing[qi["Quiz Start Time"]] || "";
      out[qi["Duration (mins)"]]   = duration;
      out[qi["Percentage"]]        = percent;
      out[qi["Submission Time"]]   = nowISO;
      if (eventId) out[qi["Event Id"]] = eventId;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${QUIZ_SHEET}!A${quizRowIdx+1}:K${quizRowIdx+1}`,
        valueInputOption: "RAW",
        requestBody: { values: [out] }
      });
    } else {
      // Insert
      const out = new Array(QUIZ_HEADERS.length).fill("");
      out[qi["Team Code"]]         = teamCode;
      out[qi["Team Name"]]         = teamName || "";
      out[qi["Total Score"]]       = totalScore;
      out[qi["Questions Correct"]] = questionsCorrect ?? "";
      out[qi["Total Questions"]]   = totalQuestions ?? "";
      out[qi["Completion Time"]]   = completionTime || nowISO;
      out[qi["Quiz Start Time"]]   = quizStartTime || "";
      out[qi["Duration (mins)"]]   = duration;
      out[qi["Percentage"]]        = percent;
      out[qi["Submission Time"]]   = nowISO;
      if (eventId) out[qi["Event Id"]] = eventId;

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${QUIZ_SHEET}!A1`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [out] }
      });
    }

    // ---------- Upsert into SUBMISSIONS sheet (for leaderboard) ----------
    const getSubm = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SUBMISSIONS_SHEET}!A1:K`
    });
    const submRows = getSubm.data.values || [];
    const submHdr = submRows[0] || SUBM_HEADERS;
    const si = indexMap(SUBM_HEADERS, submHdr);

    const idempotency = `quiz-${eventId || "EVT"}-${teamCode}`; // one row per team per event
    const payload = JSON.stringify({
      activity: "quiz",
      questionsCorrect,
      totalQuestions,
      percentage: percent,
      quizStartTime,
      completionTime: completionTime || nowISO,
      answers: Array.isArray(answers) ? answers : undefined
    });

    // find existing submissions row for this idempotency (or team+activity+event)
    let subRowIdx = -1;
    for (let r = 1; r < submRows.length; r++) {
      const row = submRows[r] || [];
      const idemp = (row[si["Idempotency"]] || "").trim();
      const act   = (row[si["Activity"]] || "").trim().toLowerCase();
      const code  = (row[si["Team Code"]] || "").trim();
      const evt   = (row[si["Event Id"]] || "").trim();
      if (idemp === idempotency || (act === "quiz" && code === teamCode && (!eventId || evt === eventId))) {
        subRowIdx = r; break;
      }
    }

    const submOut = new Array(SUBM_HEADERS.length).fill("");
    submOut[si["Timestamp"]]   = nowISO;
    submOut[si["Team Code"]]   = teamCode;
    submOut[si["Activity"]]    = "quiz";
    submOut[si["Nonce"]]       = "";              // not used
    submOut[si["Payload"]]     = payload;
    submOut[si["AI Status"]]   = "FINAL";         // no AI scoring
    submOut[si["AI Attempts"]] = "0";
    submOut[si["AI Score"]]    = "";
    submOut[si["Final Score"]] = String(totalScore);
    submOut[si["Idempotency"]] = idempotency;
    if (eventId) submOut[si["Event Id"]] = eventId;

    if (subRowIdx > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SUBMISSIONS_SHEET}!A${subRowIdx+1}:K${subRowIdx+1}`,
        valueInputOption: "RAW",
        requestBody: { values: [submOut] }
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${SUBMISSIONS_SHEET}!A1`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [submOut] }
      });
    }

    return ok({ success: true });
  } catch (e) {
    console.error("submit_quiz_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
