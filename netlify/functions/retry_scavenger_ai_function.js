// netlify/functions/retry_scavenger_ai_function.js

const {
  ok,
  error,
  isPreflight,
  getSheets,
  SHEET_ID,
  indexByHeader,
} = require("./_utils.js");

// --- helpers ---------------------------------------------------------------

const lower = (s) => String(s ?? "").trim().toLowerCase();
const norm  = (s) => String(s ?? "").trim();
const num   = (v) => (Number.isFinite(+v) ? +v : 0);

// Same robust webhook post as in submit_scavenger_function
async function postToZapHook(url, data, submissionId) {
  if (!url) return { ok: false, err: "Missing ZAP_SCAVENGER_HOOK" };
  const waits = [0, 800, 3000]; // ms backoff
  let lastErr = "unknown";
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) await new Promise((r) => setTimeout(r, waits[i]));
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000); // 10s
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Submission-Id": submissionId,
        },
        body: JSON.stringify(data),
        signal: controller.signal,
      });
      const txt = await res.text();
      clearTimeout(timer);
      if (res.ok) return { ok: true };
      lastErr = `Zap ${res.status} ${txt?.slice(0, 200) || ""}`.trim();
    } catch (e) {
      lastErr = e && e.message ? e.message : String(e);
    }
  }
  return { ok: false, err: lastErr };
}

function isScavengerActivity(raw) {
  const k = lower(raw);
  return (
    k === "scavenger" ||
    k === "scav" ||
    k === "scavenger hunt" ||
    k === "the scavenger hunt"
  );
}

// --------------------------------------------------------------------------

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});

    if (event.httpMethod !== "POST") {
      return error(405, "POST only");
    }

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return error(400, "Invalid JSON body");
    }

    // Optional filters / knobs
    const filterEventId = norm(body.eventId || body.event || "");
    const filterTeam    = norm(body.teamCode || body.team || "");
    const maxAgeSeconds = num(body.maxAgeSeconds) || 120; // how "stale" before retry
    const maxAttempts   = num(body.maxAttempts)   || 3;   // cap on retries
    const limit         = num(body.limit)         || 50;  // max rows retried per call

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "submissions!A1:M",
    });

    const values = res.data.values || [];
    if (!values.length) {
      return ok({ success: true, retried: 0, reason: "no submissions rows" });
    }

    const header = values[0] || [];
    const idx = indexByHeader(values);

    const iTs    = idx["timestamp"];
    const iTeam  = idx["team code"] ?? idx["team"];
    const iAct   = idx["activity"];
    const iNonce = idx["nonce"];
    const iPayload = idx["payload"];
    const iStatus  = idx["ai status"] ?? idx["status"];
    const iAttempts = idx["ai attempts"] ?? idx["attempts"];
    const iScore    = idx["ai score"] ?? idx["score"];
    const iFinal    = idx["final score"];
    const iIdem     = idx["idempotency"] ?? idx["submissionid"];
    const iEvent    = idx["event id"] ?? idx["eventid"];
    const iLast     = idx["last attempt at"] ?? idx["last_attempt_at"];
    const iErr      = idx["zap error"] ?? idx["error"];

    if (
      iTeam == null ||
      iAct == null ||
      iPayload == null ||
      iStatus == null
    ) {
      return error(500, "submissions sheet missing required headers");
    }

    const now = Date.now();
    const maxAgeMs = maxAgeSeconds * 1000;
    const hook = process.env.ZAP_SCAVENGER_HOOK;

    const candidates = [];

    // Pick candidates
    for (let r = 1; r < values.length; r++) {
      const row = values[r] || [];

      const teamCode = norm(row[iTeam] || "");
      if (!teamCode) continue;
      if (filterTeam && teamCode !== filterTeam) continue;

      const act = row[iAct] || "";
      if (!isScavengerActivity(act)) continue;

      const statusRaw = row[iStatus] || "";
      const status = lower(statusRaw);
      if (status.includes("final")) continue; // already processed fully

      const attempts = num(row[iAttempts] || 0);
      if (attempts >= maxAttempts) continue;

      const eventIdRow = norm(row[iEvent] || "");
      if (filterEventId && eventIdRow && eventIdRow !== filterEventId) continue;

      const lastTsStr =
        (iLast != null ? row[iLast] : null) ||
        (iTs != null ? row[iTs] : null) ||
        "";
      const lastTs = new Date(lastTsStr).getTime() || 0;
      const age = now - lastTs;
      if (age < maxAgeMs) continue; // not stale enough yet

      // We also want to distinguish between PROCESSING and ERROR but
      // both are eligible to retry once stale.
      candidates.push({ rowIndex: r, row });
      if (candidates.length >= limit) break;
    }

    if (!candidates.length) {
      return ok({
        success: true,
        retried: 0,
        reason: "no stale scavenger rows to retry",
      });
    }

    let retried = 0;
    const results = [];

    for (const { rowIndex, row } of candidates) {
      const teamCode = norm(row[iTeam] || "");
      const eventIdRow = norm(row[iEvent] || "");
      const nonce = norm(row[iNonce] || "");
      const payloadStr = row[iPayload] || "";

      let payloadObj = {};
      try {
        if (payloadStr) payloadObj = JSON.parse(payloadStr);
      } catch {
        // If payload JSON is corrupt, we can still send minimal context
        payloadObj = { rawPayload: payloadStr };
      }

      const submissionId = `retry-scavenger-${teamCode}-${nonce || rowIndex}`;

      const post = await postToZapHook(
        hook,
        {
          activity: "scavenger",
          eventId: eventIdRow,
          teamCode,
          teamName: payloadObj.teamName || "",
          timestamp: new Date().toISOString(),
          nonce: nonce,
          idempotency: row[iIdem] || "",
          submissionId,
          sheetId: SHEET_ID,
          worksheet: "submissions",
          payload: payloadObj,
          retry: true,
        },
        submissionId
      );

      // Update row: bump attempts, set status / last_attempt_at / zap_error
      const attempts = num(row[iAttempts] || 0) + 1;
      const newStatus = post.ok ? "PROCESSING" : "ERROR";
      const lastAttemptAt = new Date().toISOString();
      const zapErr = post.ok ? "" : String(post.err).slice(0, 200);

      // Build F..M row using existing values where we don’t want to change them
      const rowNum = rowIndex + 1; // 1-based including header
      const newSegment = [];

      const scoreVal = iScore != null ? row[iScore] || "" : "";
      const finalVal = iFinal != null ? row[iFinal] || "" : "";
      const idemVal  = iIdem  != null ? row[iIdem]  || "" : "";
      const evtVal   = iEvent != null ? row[iEvent] || "" : "";

      // F  AI Status
      newSegment.push(newStatus);
      // G  AI Attempts
      newSegment.push(attempts);
      // H  AI Score
      newSegment.push(scoreVal);
      // I  Final Score
      newSegment.push(finalVal);
      // J  Idempotency
      newSegment.push(idemVal);
      // K  Event Id
      newSegment.push(evtVal);
      // L  Last Attempt At
      newSegment.push(lastAttemptAt);
      // M  Zap Error
      newSegment.push(zapErr);

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `submissions!F${rowNum}:M${rowNum}`,
        valueInputOption: "RAW",
        requestBody: { values: [newSegment] },
      });

      retried++;
      results.push({
        row: rowNum,
        teamCode,
        eventId: eventIdRow,
        status: newStatus,
        attempts,
        ok: post.ok,
        err: post.ok ? null : post.err,
      });
    }

    return ok({
      success: true,
      retried,
      results,
    });
  } catch (e) {
    console.error("retry_scavenger_ai_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
