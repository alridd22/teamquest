const { ok, error, isPreflight, getSheets, SHEET_ID } = require("./_utils.js");

async function ensureSheetWithHeader(sheets, spreadsheetId, title, headers) {
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
      teamName,
      totalScore,              // 0..100
      questionsCorrect,
      totalQuestions,
      completionTime,
      quizStartTime,
      answers,
      eventId
    } = body;

    if (!teamCode || totalScore == null || totalQuestions == null) {
      return error(400, "teamCode, totalScore and totalQuestions are required");
    }

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    // Ensure tabs exist (keep your existing headers in Scores if already present)
    await ensureSheetWithHeader(
      sheets, spreadsheetId, "submissions",
      [
        "Timestamp","Team Code","Activity","Nonce","Payload",
        "AI Status","AI Attempts","AI Score","Final Score","Idempotency","Event Id"
      ]
    );
    // Do NOT force a new header if Scores already exists in legacy order.
    const scoresHeaderRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Scores!1:1"
    }).catch(() => null);

    if (!scoresHeaderRes || !(scoresHeaderRes.data?.values?.[0]?.length)) {
      // Create with legacy order (matches your sheet)
      await ensureSheetWithHeader(
        sheets, spreadsheetId, "Scores",
        ["Team Code","Activity","Score","Status","SubmissionID","Event Id"]
      );
    }

    const nowIso = new Date().toISOString();
    const percentage = Math.round((Number(questionsCorrect || 0) / Number(totalQuestions || 1)) * 100);
    const idempotency = `quiz:${eventId || ""}:${teamCode}`;

    // 1) Append detailed log to submissions
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
          nowIso,                 // Timestamp
          teamCode,               // Team Code
          "quiz",                 // Activity
          "",                     // Nonce
          payload,                // Payload
          "FINAL",                // AI Status
          "0",                    // AI Attempts
          "",                     // AI Score
          Number(totalScore) || 0,// Final Score
          idempotency,            // Idempotency
          eventId || ""           // Event Id
        ]]
      }
    });

    // 2) Append to Scores respecting current header order
    const header = (scoresHeaderRes?.data?.values?.[0] || []).map(h => String(h).trim().toLowerCase());

    const isLegacy =
      header[0] === "team code" &&
      header[1] === "activity" &&
      header[2] === "score" &&
      header[3] === "status";

    const isNew =
      header[0] === "timestamp" &&
      header.includes("team code") &&
      header.includes("activity") &&
      header.includes("score") &&
      header.includes("status");

    let scoresRow;

    if (isLegacy || !isNew) {
      // Your sheet’s layout:
      // A Team Code, B Activity, C Score, D Status, E SubmissionID, F Event Id
      scoresRow = [
        teamCode,
        "quiz",
        Number(totalScore) || 0,
        "final",
        idempotency,
        eventId || ""
      ];
    } else {
      // New layout (Timestamp first)
      scoresRow = [
        nowIso,
        teamCode,
        "quiz",
        Number(totalScore) || 0,
        "FINAL",
        eventId || ""
      ];
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Scores!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [scoresRow] }
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
