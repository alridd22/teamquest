import crypto from "crypto";
import jwt from "jsonwebtoken";
import {
  getSheets, readRange, ok, error, isPreflight, indexByHeader,
  appendRows, tabRange, nowIso
} from "./_utils.js";
import { scoreProvisional } from "./_scoring.js";

const JWT_SECRET = process.env.JWT_SECRET || process.env.TQ_JWT_SECRET;

export async function handler(event) {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    // Team auth
    const token = (event.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const claims = jwt.verify(token, JWT_SECRET);
    const teamId = claims.teamId;

    const { activity, payload = {}, clientKey } = JSON.parse(event.body || "{}");
    if (!activity) return error(400, "activity is required");

    // Deterministic SubmissionID for idempotency
    const rawKey = clientKey || JSON.stringify({ teamId, activity, payload });
    const submissionId = crypto.createHash("sha256").update(rawKey).digest("hex").slice(0, 24);

    const sheets = await getSheets();

    // Check existing submission
    const subsVals = await readRange(sheets, null, tabRange("Submissions", "A:I"));
    const subs = indexByHeader(subsVals);

    let existed = false;
    let usedScore = 0;
    for (let i = 0; i < subs.rows.length; i++) {
      const r = subs.rows[i];
      if (r[subs.idx.SubmissionID] === submissionId) {
        existed = true;
        usedScore = parseFloat(r[subs.idx.UsedScore] || r[subs.idx.FinalScore] || r[subs.idx.ProvisionalScore] || "0") || 0;
        break;
      }
    }
    if (existed) {
      return ok({ submissionId, status: "EXISTS", usedScore });
    }

    // New submission → provisional score
    const provisional = scoreProvisional(activity, payload);
    const createdAt = nowIso();

    await appendRows(sheets, null, tabRange("Submissions", "A1"), [[
      submissionId, teamId, activity, JSON.stringify(payload || {}),
      createdAt, "QUEUED", provisional.toString(), "", provisional.toString()
    ]]);

    await appendRows(sheets, null, tabRange("Scores", "A1"), [[
      teamId, activity, provisional.toString(), "provisional", submissionId
    ]]);

    return ok({ submissionId, status: "QUEUED", provisional, usedScore: provisional });
  } catch (e) {
    console.error("submit_activity_function error:", e);
    return error(400, e.message);
  }
}
