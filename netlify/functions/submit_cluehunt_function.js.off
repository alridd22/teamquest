// submit_cluehunt_function.js
const { ok, error, isPreflight, getSheets, SHEET_ID } = require("./_utils.js");

/** Ensure a sheet exists (and optionally seed header) */
async function ensureSheetWithHeader(sheets, spreadsheetId, title, headers) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some(s => s.properties?.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] }
    });
    if (headers?.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${title}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [headers] }
      });
    }
  }
}

function lcHeaders(row = []) {
  const out = {};
  (row || []).forEach((h, i) => (out[String(h || "").trim().toLowerCase()] = i));
  return out;
}

/** Read a whole tab (A:Z) and return { header, rows } */
async function readTab(sheets, spreadsheetId, title) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${title}!A:Z`,
  }).catch(() => null);
  const values = res?.data?.values || [];
  return { header: values[0] || [], rows: values.slice(1) };
}

/** Detect Scores layout and give row builder */
function makeScoresRowBuilder(scoresHeader) {
  const h = scoresHeader.map(x => String(x || "").trim().toLowerCase());
  const isLegacy =
    h[0] === "team code" &&
    h[1] === "activity" &&
    h[2] === "score" &&
    h[3] === "status";

  if (isLegacy) {
    // Team Code | Activity | Score | Status | SubmissionID | Event Id
    return (teamCode, activity, score, status, submissionId, eventId) => ([
      teamCode, activity, Number(score) || 0, status, submissionId, eventId || ""
    ]);
  }
  // New layout fallback: Timestamp | Team Code | Activity | Score | Status | Event Id
  return (teamCode, activity, score, status, submissionId, eventId) => ([
    new Date().toISOString(), teamCode, activity, Number(score) || 0, status, eventId || ""
  ]);
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return error(400, "Invalid JSON"); }

    const {
      teamCode,
      teamName,
      clueId,             // number 1..20
      clueText,
      userAnswer,
      correctAnswer,
      points,             // number (0 if wrong, 5..10 if right)
      currentScore,       // running total client-side (for payload only)
      wasCorrect,         // boolean
      eventId             // optional
    } = body || {};

    if (!teamCode || !clueId || points == null) {
      return error(400, "Missing required fields: teamCode, clueId, points");
    }

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    // Ensure tabs exist
    await ensureSheetWithHeader(
      sheets, spreadsheetId, "submissions",
      [
        "Timestamp","Team Code","Activity","Nonce","Payload",
        "AI Status","AI Attempts","AI Score","Final Score","Idempotency","Event Id"
      ]
    );

    // Get Scores header (if absent, create with legacy order)
    let { header: scoresHeader } = await readTab(sheets, spreadsheetId, "Scores");
    if (!scoresHeader.length) {
      await ensureSheetWithHeader(
        sheets, spreadsheetId, "Scores",
        ["Team Code","Activity","Score","Status","SubmissionID","Event Id"]
      );
      ({ header: scoresHeader } = await readTab(sheets, spreadsheetId, "Scores"));
    }
    const buildScoresRow = makeScoresRowBuilder(scoresHeader);

    // Build an idempotency key per team + clue
    const idem = `clue:${eventId || ""}:${teamCode}:${clueId}`;

    // Prevent double-scoring: if this idem already exists in Scores, bail out gracefully
    {
      const { header: h, rows } = await readTab(sheets, spreadsheetId, "Scores");
      const idx = lcHeaders(h);
      const subIdIdx = (idx["submissionid"] != null ? idx["submissionid"] : idx["idempotency"]);
      if (subIdIdx != null) {
        const dup = rows.some(r => (r[subIdIdx] || "") === idem);
        if (dup) return ok({ success: true, deduped: true, message: "Clue already recorded" });
      }
    }

    const nowIso = new Date().toISOString();

    // 1) Append detailed log to submissions
    const payload = JSON.stringify({
      activity: "clue",
      clueId: Number(clueId),
      clueText: String(clueText || ""),
      userAnswer: String(userAnswer || ""),
      correctAnswer: String(correctAnswer || ""),
      points: Number(points) || 0,
      wasCorrect: !!wasCorrect,
      currentScore: Number(currentScore || 0),
      teamName: teamName || "",
      attemptTime: nowIso
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "submissions!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          nowIso,             // Timestamp
          teamCode,           // Team Code
          "clue",             // Activity
          "",                 // Nonce
          payload,            // Payload
          "FINAL",            // AI Status
          "0",                // AI Attempts
          "",                 // AI Score (unused)
          Number(points)||0,  // Final Score (this attempt)
          idem,               // Idempotency
          eventId || ""       // Event Id
        ]]
      }
    });

    // 2) Append to Scores (legacy-safe)
    const scoresRow = buildScoresRow(
      teamCode, "clue", Number(points) || 0, "final", idem, eventId || ""
    );

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Scores!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [scoresRow] }
    });

    return ok({
      success: true,
      message: "Clue recorded",
      teamCode,
      clueId: Number(clueId),
      points: Number(points) || 0
    });

  } catch (e) {
    console.error("submit_cluehunt_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};

