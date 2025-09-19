// netlify/functions/zapier_update_score_function.js
const { ok, error, isPreflight, getSheets, tabRange, SHEET_ID } = require("./_utils.js");

/**
 * Expected Sheet headers (row 1) in the "submissions" tab:
 * Timestamp | Team Code | Activity | Nonce | Payload | AI Status | AI Attempts | AI Score | Final Score | Idempotency | Event Id
 */

function parseJson(body) {
  try { return JSON.parse(body || "{}"); }
  catch { return null; }
}

function parseCompositeId(id = "") {
  // Accept: activity-team-nonce   OR   activity-team-item-nonce
  const parts = String(id).trim().split("-").filter(Boolean);
  if (parts.length < 3) return null;
  const activity = parts[0];
  const teamCode = parts[1];
  const nonce    = parts[parts.length - 1]; // last piece is always the nonce
  return { activity, teamCode, nonce };
}

async function ensureTab(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some(s => s.properties?.title === "submissions");
  if (!exists) throw new Error('Sheet "submissions" not found');
}

async function findRowNumber(sheets, spreadsheetId, { activity, teamCode, nonce, idempotency, submissionId }) {
  // Read all rows (except header), then scan from the bottom for the newest match
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: tabRange("submissions", "A2:K"),
    majorDimension: "ROWS"
  });
  const rows = resp.data.values || [];

  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i] || [];
    const teamCell  = r[1] || ""; // B
    const actCell   = r[2] || ""; // C
    const nonceCell = r[3] || ""; // D
    const idemCell  = r[9] || ""; // J

    // Primary match: activity + team + nonce
    if (activity && teamCode && nonce && actCell === activity && teamCell === teamCode && nonceCell === nonce) {
      return i + 2; // +2 because we started at A2
    }
    // Fallback: explicit idempotency
    if (idempotency && idemCell === idempotency) return i + 2;
    // Legacy fallback: some older rows stored submissionId in column J
    if (submissionId && idemCell === submissionId) return i + 2;
  }
  return null;
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    const body = parseJson(event.body);
    if (!body) return error(400, "Invalid JSON body");

    // Accept any of these:
    // - submissionId: "activity-team-nonce" OR "activity-team-item-nonce"
    // - OR explicit activity, teamCode, nonce
    // - Optionally idempotency for fallback
    let { submissionId, activity, teamCode, nonce, idempotency, eventId } = body;

    // Score fields
    const finalScore = Number(body.finalScore);
    const aiScore    = body.aiScore != null ? String(body.aiScore) : ""; // optional
    const aiStatus   = (body.aiStatus || "FINAL").toString();            // default to FINAL

    if (!Number.isFinite(finalScore)) {
      return error(400, "finalScore must be a number");
    }

    // Derive from submissionId if needed (works for both 3- and 4-part ids)
    if ((!activity || !teamCode || !nonce) && submissionId) {
      const parsed = parseCompositeId(submissionId);
      if (parsed) {
        activity = activity || parsed.activity;
        teamCode = teamCode || parsed.teamCode;
        nonce    = nonce    || parsed.nonce;
      }
    }

    // Minimal keys to find the row
    if ((!activity || !teamCode || !nonce) && !idempotency && !submissionId) {
      return error(400, "Provide submissionId or (activity, teamCode, nonce) or idempotency");
    }

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    // Ensure tab exists (gives a clear error if not)
    await ensureTab(sheets, spreadsheetId);

    const rowNumber = await findRowNumber(sheets, spreadsheetId, {
      activity, teamCode, nonce, idempotency, submissionId
    });

    if (!rowNumber) {
      return error(404, "Submission not found");
    }

    // Prepare updates:
    // F: AI Status, H: AI Score (optional), I: Final Score
    const updates = [
      { range: `submissions!F${rowNumber}`, values: [[aiStatus]] },
      { range: `submissions!I${rowNumber}`, values: [[String(finalScore)]] }
    ];
    if (aiScore !== "") {
      updates.push({ range: `submissions!H${rowNumber}`, values: [[aiScore]] });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: updates
      }
    });

    return ok({
      success: true,
      message: "Score updated",
      rowNumber,
      activity,
      teamCode,
      nonce,
      finalScore
    });
  } catch (e) {
    console.error("zapier_update_score_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
