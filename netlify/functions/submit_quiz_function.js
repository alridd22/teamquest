// netlify/functions/submit_quiz_function.js
const { ok, error, isPreflight, getSheets, SHEET_ID } = require("./_utils.js");

async function ensureSheetWithHeader(sheets, spreadsheetId, title, headers) {
  // Create the sheet if missing and seed headers
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some(s => s.properties?.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] }
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${title}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] }
    });
  }
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
      teamName,                // optional
      totalScore,              // number (0..100)
      questionsCorrect,        // number
      totalQuestions,          // number
      completionTime,          // ISO string
      quizStartTime,           // ISO string
      answers,                 // array (optional)
      eventId                  // optional
    } = body;

    if (!teamCode || totalScore == null || totalQuestions == null) {
      return error(400, "teamCode, totalScore and totalQuestions are required");
    }

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    // Make sure the two tabs exist
    await ensureSheetWithHeader(
      sheets, spreadsheetId, "submissions",
      [
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
      ]
    );

    await ensureSheetWithHeader(
      sheets, spreadsheetId, "Scores",
      [
        "Timestamp",     // A
        "Team Code",     // B
        "Activity",      // C
        "Score",         // D
        "Status",        // E
        "Event Id"       // F
      ]
    );

    const nowIso = new Date().toISOString();
    const percentage = Math.round((Number(questionsCorrect || 0) / Number(totalQuestions || 1)) * 100);
    const idempotency = `quiz:${eventId || ""}:${teamCode}`; // simple de-dupe key

    // 1) Append to submissions (detailed log)
    const payload = JSON.stringify({
      activity: "quiz",
      questionsCorrect: Number(questionsCorrect || 0),
      totalQuestions: Number(totalQuestions || 0),
      percentage: String(percentage),
      completion: "FINAL",
      teamName: teamName || "",
      completionTime: completionTime || nowIso,
      quizStartTime: quizStartTime || "",
      answers: Array.isArray(answers) ? answers : []
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "submissions!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          nowIso,           // Timestamp
          teamCode,         // Team Code
          "quiz",           // Activity
          "",               // Nonce (unused)
          payload,          // Payload (JSON)
          "FINAL",          // AI Status (treated as final)
          "0",              // AI Attempts
          "",               // AI Score
          Number(totalScore) || 0, // Final Score
          idempotency,      // Idempotency
          eventId || ""     // Event Id
        ]]
      }
    });

    // 2) Append to Scores (what your leaderboard reads)
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Scores!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          nowIso,                 // Timestamp
          teamCode,               // Team Code
          "quiz",                 // Activity
          Number(totalScore) || 0,// Score
          "FINAL",                // Status
          eventId || ""           // Event Id
        ]]
      }
    });

    return ok({
      success: true,
      message: "Quiz score recorded",
      teamCode,
      totalScore: Number(totalScore) || 0
    });

  } catch (e) {
    console.error("submit_quiz_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
