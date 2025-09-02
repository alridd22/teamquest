// netlify/functions/submit_quiz_answer_function.js
const {
  ok, error, isPreflight,
  getSheets, tabRange, SHEET_ID
} = require("./_utils.js");

/* ---------- normalization & matching ---------- */
const norm = (s) => String(s ?? "")
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "")
  .trim();

function isMatch(user, expected) {
  const u = norm(user);
  const variants = String(expected || "")
    .split("|")
    .map(x => x.trim())
    .filter(Boolean);
  const list = variants.length ? variants : [expected];

  // exact normalized match
  for (const v of list) {
    if (u === norm(v)) return true;
  }
  // numeric equivalence: "1,908" === "1908"
  const numU = (user || "").replace(/[^\d.-]/g, "");
  for (const v of list) {
    const numV = (v || "").replace(/[^\d.-]/g, "");
    if (numU && numV && !isNaN(+numU) && !isNaN(+numV) && +numU === +numV) {
      return true;
    }
  }
  return false;
}

async function getQuizBank(sheets, ssid) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: ssid, range: tabRange("QuizBank", "A:C"),
  });
  const v = r.data.values || [];
  const head = v[0] || [];
  const idx = {}; head.forEach((h, i) => (idx[h] = i));
  const rows = v.slice(1).map(row => ({
    QuestionID: row[idx["QuestionID"]] ?? row[0] ?? "",
    Answer:     row[idx["CorrectAnswer"]] ?? row[1] ?? "",
    Points:     Number(row[idx["Points"]] ?? row[2] ?? 0),
  }));
  const byId = new Map();
  rows.forEach(r => { if (r.QuestionID) byId.set(String(r.QuestionID), r); });
  return byId;
}

async function getExistingScoreForIdem(sheets, ssid, idem) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: ssid, range: tabRange("Scores", "A:E"),
  });
  const vals = r.data.values || [];
  for (let i = 1; i < vals.length; i++) {
    if ((vals[i][4] || "") === idem) {
      return Number(vals[i][2] || 0); // Score col
    }
  }
  return null;
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return error(400, "Invalid JSON"); }

    const teamCode   = String(body.teamCode || "").trim();
    const questionId = String(body.questionId || "").trim(); // e.g., "Q3"
    const answer     = String(body.answer || "").trim();     // e.g., "B" or "tennis"

    if (!teamCode || !questionId || !answer) {
      return error(400, "teamCode, questionId, answer are required");
    }

    const sheets = await getSheets();
    const ssid = SHEET_ID;

    // Load bank and find question
    const bank = await getQuizBank(sheets, ssid);
    const q = bank.get(questionId);
    if (!q) return error(404, `Unknown questionId ${questionId}`);

    const submissionId = `quiz-${teamCode}-${questionId}`;

    // Idempotency: if already answered, return original result
    const prior = await getExistingScoreForIdem(sheets, ssid, submissionId);
    if (prior !== null) {
      return ok({
        success: true,
        alreadySubmitted: true,
        submissionId,
        correct: prior > 0,
        pointsAwarded: prior,
        pointsPossible: Number(q.Points) || 0,
      });
    }

    // Score
    const correct = isMatch(answer, q.Answer);
    const pointsPossible = Number(q.Points) || 0;
    const pointsAwarded = correct ? pointsPossible : 0;

    // Write to submissions (one row per question answered)
    const timestamp = new Date().toISOString();
    await sheets.spreadsheets.values.append({
      spreadsheetId: ssid,
      range: tabRange("submissions", "A1"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[
        timestamp,                        // Timestamp
        teamCode,                         // Team Code
        "quiz_q",                         // Activity (per-question)
        questionId,                       // Nonce
        JSON.stringify({ questionId, givenAnswer: answer, pointsPossible }),
        "FINAL",                          // AI Status (not used)
        "0",                              // AI Attempts
        correct ? "1" : "0",              // AI Score (1/0)
        String(pointsAwarded),            // Final Score (per-question)
        submissionId,                     // Idempotency
        ""                                // Event Id
      ]]}
    });

    // Write to Scores (one row per question; leaderboard sums all)
    await sheets.spreadsheets.values.append({
      spreadsheetId: ssid,
      range: tabRange("Scores", "A1"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[
        teamCode, "quiz", String(pointsAwarded), "final", submissionId
      ]]}
    });

    return ok({
      success: true,
      submissionId,
      correct,
      pointsAwarded,
      pointsPossible
    });
  } catch (e) {
    console.error("submit_quiz_answer_function:", e);
    return error(500, e.message || "Unexpected error");
  }
};
