// submit_quiz.js — CommonJS, uses shared utils

const {
  ok, error, isPreflight,
  getDoc, // from _utils.js: authenticated GoogleSpreadsheet
} = require("./_utils.js");

module.exports.handler = async (event) => {
  console.log("Submit Quiz request started at:", new Date().toISOString());

  try {
    // CORS preflight
    if (isPreflight(event)) return ok({ message: "CORS preflight successful" });

    // Only POST
    if (event.httpMethod !== "POST") {
      return error(405, "Method not allowed");
    }

    // Parse body
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return error(400, "Invalid JSON in request body");
    }

    const {
      teamCode,
      teamName,
      totalScore,
      questionsCorrect,
      totalQuestions,
      completionTime,
      quizStartTime,
      answers,
    } = body;

    if (!teamCode || !teamName || totalScore === undefined) {
      return error(400, "Missing required fields");
    }

    // Authenticated doc via shared utils (robust env/file fallback)
    const doc = await getDoc?.();
    if (!doc) return error(500, "Spreadsheet client not available");

    // Duration
    let durationMinutes = "";
    if (quizStartTime && completionTime) {
      const startTime = new Date(quizStartTime);
      const endTime = new Date(completionTime);
      const durationMs = endTime - startTime;
      durationMinutes = Math.round((durationMs / (1000 * 60)) * 10) / 10; // one decimal
    }

    // Percentage
    const percentage =
      totalQuestions > 0
        ? Math.round(((questionsCorrect || 0) / totalQuestions) * 100)
        : 0;

    // ---- Quiz sheet upsert ----
    const quizSheet = doc.sheetsByTitle ? doc.sheetsByTitle["Quiz"] : null;
    if (!quizSheet) {
      return error(
        500,
        "Quiz sheet not found. Please ensure the Quiz sheet exists in your Google Spreadsheet."
      );
    }

    await quizSheet.loadHeaderRow();
    const rows = await quizSheet.getRows();

    const row = rows.find((r) => r.get("Team Code") === teamCode);

    if (row) {
      row.set("Team Name", teamName);
      row.set("Total Score", String(totalScore));
      row.set("Questions Correct", questionsCorrect != null ? String(questionsCorrect) : "");
      row.set("Total Questions", totalQuestions != null ? String(totalQuestions) : "");
      row.set("Completion Time", completionTime || "");
      row.set("Duration (mins)", String(durationMinutes));
      row.set("Percentage", String(percentage));
      row.set("Submission Time", new Date().toISOString());
      if (quizStartTime && !row.get("Quiz Start Time")) {
        row.set("Quiz Start Time", quizStartTime);
      }
      await row.save();
      console.log("Updated existing quiz row for team:", teamCode);
    } else {
      await quizSheet.addRow({
        "Team Code": teamCode,
        "Team Name": teamName,
        "Total Score": String(totalScore),
        "Questions Correct": questionsCorrect != null ? String(questionsCorrect) : "",
        "Total Questions": totalQuestions != null ? String(totalQuestions) : "",
        "Completion Time": completionTime || "",
        "Quiz Start Time": quizStartTime || "",
        "Duration (mins)": String(durationMinutes),
        "Percentage": String(percentage),
        "Submission Time": new Date().toISOString(),
      });
      console.log("Created new quiz row for team:", teamCode);
    }

    // ---- Leaderboard update (best-effort) ----
    try {
      const leaderboardSheet = doc.sheetsByTitle ? doc.sheetsByTitle["Leaderboard"] : null;
      if (leaderboardSheet) {
        await leaderboardSheet.loadHeaderRow();
        const lrows = await leaderboardSheet.getRows();

        const lrow = lrows.find((r) => r.get("Team Code") === teamCode);
        if (lrow) {
          lrow.set("Quiz", String(totalScore));

          const registration = parseInt(lrow.get("Registration") || "0", 10);
          const clueHunt    = parseInt(lrow.get("Clue Hunt") || "0", 10);
          const quiz        = parseInt(lrow.get("Quiz") || "0", 10);
          const kindness    = parseInt(lrow.get("Kindness") || "0", 10);
          const scavenger   = parseInt(lrow.get("Scavenger") || "0", 10);
          const limerick    = parseInt(lrow.get("Limerick") || "0", 10);

          const newTotal = registration + clueHunt + quiz + kindness + scavenger + limerick;
          lrow.set("Total", String(newTotal));

          await lrow.save();
          console.log("Updated leaderboard for team:", teamCode, "with quiz score:", totalScore);
        } else {
          console.log("Team not found in leaderboard:", teamCode);
        }
      }
    } catch (e) {
      console.error("Error updating leaderboard:", e);
      // non-fatal
    }

    // ---- Quiz Answers (optional; best-effort) ----
    try {
      const answersSheet = doc.sheetsByTitle ? doc.sheetsByTitle["Quiz Answers"] : null;
      if (answersSheet && Array.isArray(answers) && answers.length) {
        await answersSheet.loadHeaderRow();
        for (const a of answers) {
          await answersSheet.addRow({
            "Team Code": teamCode,
            "Team Name": teamName,
            "Question ID": a?.questionId != null ? String(a.questionId) : "",
            "User Answer": a?.userAnswer || "",
            "Correct Answer": a?.correctAnswer || "",
            "Is Correct": a?.isCorrect ? "TRUE" : "FALSE",
            "Doubloons Earned": a?.doubloons != null ? String(a.doubloons) : "0",
            "Time Left": a?.timeLeft != null ? String(a.timeLeft) : "",
            "Submission Time": new Date().toISOString(),
          });
        }
        console.log("Stored", answers.length, "quiz answers for team:", teamCode);
      }
    } catch (e) {
      console.error("Error storing quiz answers:", e);
      // non-fatal
    }

    console.log("Quiz submission completed successfully for team:", teamCode);
    return ok({
      success: true,
      message: "Quiz results submitted successfully",
      teamCode,
      totalScore,
      questionsCorrect,
      percentage,
    });
  } catch (e) {
    console.error("Submit Quiz Function Error:", e);
    return error(500, "Internal server error", { details: e.message });
  }
};
