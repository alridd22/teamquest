// netlify/functions/zapier_update_score_function.js
import {
  getSheets,
  readRange,
  writeRange,
  appendRows,
  ok,
  error,
  isPreflight,
  indexByHeader,
  tabRange,
  requireAdmin,
} from "./_utils.js";

/**
 * Expected POST body (JSON):
 *   { submissionId: string, finalScore: number }
 *
 * Sheet layout (tab: "submissions"):
 *   A Timestamp | B Team Code | C Activity | D Nonce | E Payload
 *   F AI Status | G AI Attempts | H AI Score | I Final Score | J Idempotency | K Event Id
 *
 * Optional "scores" tab (A:E):
 *   Team | Activity | Points | Source | Idempotency
 */

export async function handler(event) {
  try {
    // CORS preflight
    if (isPreflight(event)) return ok({});

    if (event.httpMethod !== "POST") {
      return error(405, "POST only");
    }

    // Admin gate (reads x-admin-secret header; see _utils.js)
    requireAdmin(event);

    // Parse body
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch (_) {
      return error(400, "Invalid JSON body");
    }

    const submissionId = String(body.submissionId || "").trim();
    const finalScoreNum =
      typeof body.finalScore === "number"
        ? body.finalScore
        : parseFloat(body.finalScore);

    if (!submissionId || Number.isNaN(finalScoreNum)) {
      return error(
        400,
        "submissionId (string) and finalScore (number) required"
      );
    }

    // Coerce to integer and clamp 0..100 just to be safe (front-end already clamps)
    const finalScore = Math.max(0, Math.min(100, Math.round(finalScoreNum)));

    const sheets = await getSheets();

    // --- SUBMISSIONS (lowercase tab name, include J for Idempotency) ---
    // Use tabRange to respect CURRENT_EVENT_ID if set (e.g., submissions_EVT1)
    const subsVals = await readRange(sheets, null, tabRange("submissions", "A:K"));
    const subs = indexByHeader(subsVals);

    // Resolve the id column (prefer "Idempotency"; fall back to "SubmissionID"/"SubmissionId")
    const idCol =
      subs.idx.Idempotency ??
      subs.idx.SubmissionID ??
      subs.idx.SubmissionId ??
      subs.idx.id ??
      null;

    if (idCol == null) {
      return error(500, "Sheet header missing Idempotency/SubmissionID");
    }

    // Find row by idempotency/submissionId
    let row = -1;
    let existing = null;
    for (let i = 0; i < subs.rows.length; i++) {
      const v = String(subs.rows[i][idCol] || "").trim();
      if (v === submissionId) {
        row = i + 2; // +2: header row + 1-based
        existing = subs.rows[i];
        break;
      }
    }
    if (row < 0) return error(404, "Submission not found");

    const teamId =
      existing[subs.idx["Team Code"]] ??
      existing[subs.idx.TeamID] ??
      existing[subs.idx.Team] ??
      "";
    const activity = existing[subs.idx.Activity] ?? "";

    // Keep existing attempts & provisional AI score (H)
    const attempts = existing[subs.idx["AI Attempts"]] ?? "";
    const aiScore =
      existing[subs.idx["AI Score"]] ??
      existing[subs.idx.ProvisionalScore] ??
      "";

    // Write back to F:I   [AI Status, AI Attempts, AI Score, Final Score]
    await writeRange(
      sheets,
      null,
      tabRange("submissions", `F${row}:I${row}`),
      [[
        "FINAL", // F: AI Status
        attempts, // G: keep attempts as-is
        aiScore, // H: keep AI Score as-is (provisional / model output)
        String(finalScore), // I: Final Score
      ]]
    );

    // --- SCORES (optional) ---
    // If a "scores" tab exists with columns: Team | Activity | Points | Source | Idempotency
    try {
      const scoresVals = await readRange(sheets, null, tabRange("scores", "A:E"));
      if (scoresVals && scoresVals.length) {
        let replaced = false;
        for (let i = 1; i < scoresVals.length; i++) {
          const r = scoresVals[i];
          if ((r[4] || "") === submissionId) {
            r[2] = String(finalScore); // Points
            r[3] = "final"; // Source
            replaced = true;
          }
        }
        if (replaced) {
          await writeRange(sheets, null, tabRange("scores", "A1"), scoresVals);
        } else {
          await appendRows(sheets, null, tabRange("scores", "A1"), [
            [teamId, activity, String(finalScore), "final", submissionId],
          ]);
        }
      }
    } catch (e) {
      // If "scores" sheet missing, ignore
      console.warn("scores sheet update skipped:", e.message);
    }

    return ok({
      updated: true,
      submissionId,
      teamId,
      activity,
      finalScore,
    });
  } catch (e) {
    const status = e.statusCode || 400;
    console.error("zapier_update_score_function error:", e);
    return error(status, e.message || String(e));
  }
}
