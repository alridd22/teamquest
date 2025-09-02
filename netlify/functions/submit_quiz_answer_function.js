// submit_quiz_answer_function.js — CommonJS, uses shared utils

const {
  ok, error, isPreflight, getDoc,
} = require("./_utils.js");

// ----- CONFIG -----
const QUIZ_ANSWERS_TAB = "QuizAnswers";
const QUIZ_SUBMISSIONS_TAB = "QuizSubmissions"; // audit trail
const SCORES_TAB = "Scores";                    // leaderboard feed
const DEFAULT_POINTS = 10;

// Normalize answers to allow: case-insensitive, strip punctuation/spaces,
// treat "1,908" == "1908", "E O" == "EO", etc.
function normalize(s) {
  if (typeof s !== "string") return "";
  return s
    .toLowerCase()
    .trim()
    // remove anything not a-z or 0-9
    .replace(/[^a-z0-9]+/g, "");
}

// Split "CorrectAnswer" cell into acceptable list.
// Supports commas or pipes. Strips quotes/spaces.
function explodeAcceptables(cell) {
  if (!cell) return [];
  const raw = String(cell);
  // split on comma or pipe
  return raw
    .split(/[|,]/g)
    .map(x => x.trim().replace(/^['"]|['"]$/g, "")) // remove surrounding quotes
    .filter(Boolean);
}

// Build an idempotent-ish submission Id
function makeSubmissionId(teamCode, questionId) {
  const t = new Date().toISOString();
  return `quiz-${teamCode}-${questionId}-${t}`;
}

module.exports.handler = async (event) => {
  try {
    // CORS preflight
    if (isPreflight(event)) return ok({});

    if (event.httpMethod !== "POST") return error(405, "Method not allowed");

    // Parse body
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return error(400, "Invalid JSON body");
    }

    const { teamCode, teamName, questionId, userAnswer } = body || {};
    if (!teamCode || !teamName || !questionId) {
      return error(400, "teamCode, teamName, and questionId are required");
    }
    if (typeof userAnswer !== "string") {
      return error(400, "userAnswer must be a string");
    }

    // Get spreadsheet
    const doc = await getDoc?.();
    if (!doc) return error(500, "Spreadsheet client not available");

    // Ensure answers tab exists and has headers
    let answersSheet = doc.sheetsByTitle?.[QUIZ_ANSWERS_TAB];
    if (!answersSheet) {
      return error(500, `Quiz answers tab "${QUIZ_ANSWERS_TAB}" not found`);
    }
    await answersSheet.loadHeaderRow();
    const headers = answersSheet.headerValues?.map(h => (h || "").toString().trim());
    const qidIdx = headers?.indexOf("QuestionID");
    const corrIdx = headers?.indexOf("CorrectAnswer");
    const ptsIdx = headers?.indexOf("Points");
    if (qidIdx === -1 || corrIdx === -1 || ptsIdx === -1) {
      return error(500, `Expected headers "QuestionID | CorrectAnswer | Points" in "${QUIZ_ANSWERS_TAB}"`);
    }

    // Fetch answer row for the question
    const rows = await answersSheet.getRows({ limit: 0 }); // all
    const row = rows.find(r => String(r.get("QuestionID")).trim().toLowerCase() === String(questionId).trim().toLowerCase());
    if (!row) {
      return error(404, `Question ${questionId} not found in ${QUIZ_ANSWERS_TAB}`);
    }

    const correctCell = row.get("CorrectAnswer");
    const pointsCell = row.get("Points");
    const pointsForQuestion = Number(pointsCell) || DEFAULT_POINTS;

    // Prepare acceptable answers list
    // If only a single token (e.g. "B"), explodeAcceptables returns ["B"] as well.
    const acceptableList = explodeAcceptables(correctCell);
    const normalizedAcceptables = acceptableList.map(a => normalize(a));

    // Compare normalized answers
    const normalizedUser = normalize(userAnswer);

    // Special case: if there were no separators and the cell is something like "B"
    // explodeAcceptables still returns ["B"], which is correct for MCQs.
    const isCorrect = normalizedAcceptables.includes(normalizedUser);

    // Points
    const pointsAwarded = isCorrect ? pointsForQuestion : 0;

    // --- Write audit row to QuizSubmissions ---
    let subSheet = doc.sheetsByTitle?.[QUIZ_SUBMISSIONS_TAB];
    if (!subSheet) {
      subSheet = await doc.addSheet({
        title: QUIZ_SUBMISSIONS_TAB,
        headerValues: [
          "Timestamp",
          "Team Code",
          "Team Name",
          "QuestionID",
          "User Answer",
          "Normalized User",
          "Acceptable Answers",
          "Correct",
          "Points Awarded"
        ]
      });
    } else {
      await subSheet.loadHeaderRow();
      if (!subSheet.headerValues || subSheet.headerValues.length === 0) {
        await subSheet.setHeaderRow([
          "Timestamp",
          "Team Code",
          "Team Name",
          "QuestionID",
          "User Answer",
          "Normalized User",
          "Acceptable Answers",
          "Correct",
          "Points Awarded"
        ]);
        await subSheet.loadHeaderRow();
      }
    }

    await subSheet.addRow({
      "Timestamp": new Date().toISOString(),
      "Team Code": teamCode,
      "Team Name": teamName,
      "QuestionID": String(questionId),
      "User Answer": userAnswer,
      "Normalized User": normalizedUser,
      "Acceptable Answers": acceptableList.join(" | "),
      "Correct": isCorrect ? "TRUE" : "FALSE",
      "Points Awarded": String(pointsAwarded)
    });

    // --- Append to Scores for leaderboard rollup ---
    // Structure used across the project: [Team Code, Activity, Score, Status, SubmissionID]
    // Here: Activity = "quiz-q<id>", Status = "auto"
    let scoresSheet = doc.sheetsByTitle?.[SCORES_TAB];
    if (!scoresSheet) {
      scoresSheet = await doc.addSheet({
        title: SCORES_TAB,
        headerValues: ["Team Code", "Activity", "Score", "Status", "SubmissionID"]
      });
    } else {
      await scoresSheet.loadHeaderRow();
      if (!scoresSheet.headerValues || scoresSheet.headerValues.length === 0) {
        await scoresSheet.setHeaderRow(["Team Code", "Activity", "Score", "Status", "SubmissionID"]);
        await scoresSheet.loadHeaderRow();
      }
    }

    const submissionId = makeSubmissionId(teamCode, questionId);
    await scoresSheet.addRow([
      teamCode,
      `quiz-q${String(questionId).replace(/^q/i, "")}`,
      String(pointsAwarded),
      "auto",
      submissionId
    ]);

    // Respond for immediate UI feedback
    return ok({
      success: true,
      questionId,
      correct: isCorrect,
      pointsAwarded,
      accepted: acceptableList,     // useful for debugging/UI if needed
    });
  } catch (e) {
    console.error("submit_quiz_answer_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
