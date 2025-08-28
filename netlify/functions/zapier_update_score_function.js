// netlify/functions/zapier_update_score_function.js
const {
  getSheets, readRange, writeRange, appendRows, ok, error, isPreflight,
  indexByHeader, tabRange, requireAdmin
} = require("./_utils.js");

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    requireAdmin(event);

    const { submissionId, finalScore } = JSON.parse(event.body || "{}");
    const scoreNum = Number(finalScore);
    if (!submissionId || !Number.isFinite(scoreNum)) {
      return error(400, "submissionId (string) and finalScore (number) required");
    }

    const sheets = await getSheets();

    // Update Submissions (tab name must match your sheet; keep 'submissions' if that's what you use)
    const subsVals = await readRange(sheets, null, tabRange("submissions", "A:K"));
    const subs = indexByHeader(subsVals);

    let row = -1;
    let existing;
    for (let i = 0; i < subs.rows.length; i++) {
      if (subs.rows[i][subs.idx.Idempotency] === submissionId) {
        row = i + 2; existing = subs.rows[i]; break;
      }
    }
    if (row < 0) return error(404, "Submission not found");

    const teamCode = existing[subs.idx["Team Code"]];
    const activity = existing[subs.idx.Activity];

    await writeRange(sheets, null, tabRange("submissions", `F${row}:I${row}`), [[
      "FINAL",
      existing[subs.idx["AI Attempts"]] || "0",
      existing[subs.idx["AI Score"]] || "",
      String(scoreNum)
    ]]);

    // Update or Append in Scores
    const scoresVals = await readRange(sheets, null, tabRange("Scores", "A:E"));
    let replaced = false;
    for (let i = 1; i < scoresVals.length; i++) {
      const r = scoresVals[i];
      if (r[4] === submissionId) { // SubmissionID col
        r[2] = String(scoreNum);
        r[3] = "final";
        replaced = true;
      }
    }
    if (replaced) {
      await writeRange(sheets, null, tabRange("Scores", "A1"), scoresVals);
    } else {
      await appendRows(sheets, null, tabRange("Scores", "A1"), [[
        teamCode, activity, String(scoreNum), "final", submissionId
      ]]);
    }

    return ok({ updated: true, submissionId, teamCode, activity, finalScore: scoreNum });
  } catch (e) {
    console.error("zapier_update_score_function error:", e);
    return error(400, e.message);
  }
};
