// start_quiz_function.js (idempotent + resumable start)
// Keeps your "Quiz" tab and HEADERS; fixes lock + normalizes matching.

const { ok, error, isPreflight, getSheets, SHEET_ID } = require("./_utils.js");

const SHEET_NAME = "Quiz";
const HEADERS = [
  "Team Code",        // A
  "Team Name",        // B
  "Total Score",      // C
  "Questions Correct",// D
  "Total Questions",  // E
  "Completion Time",  // F
  "Quiz Start Time",  // G
  "Duration (mins)",  // H
  "Percentage",       // I
  "Submission Time",  // J
  "Event Id"          // K
];

const norm = (s) => String(s ?? "").trim();
const u    = (s) => norm(s).toUpperCase();

/** Ensure Quiz sheet + headers exist */
async function ensureSheetExists(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some(
    (s) => s.properties?.title === SHEET_NAME
  );
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
      },
    });
  }
  // Ensure headers in row 1 (keeps your layout stable)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADERS] },
  });
}

function headerIndexMap(row0 = []) {
  const map = {};
  // start with your canonical HEADERS
  HEADERS.forEach((h, i) => (map[h] = i));
  // tolerate capitalization drift in a live sheet
  row0.forEach((cell, i) => {
    const n = String(cell || "").trim().toLowerCase();
    HEADERS.forEach((h) => {
      if (n && n === h.toLowerCase()) map[h] = i;
    });
  });
  return map;
}

/**
 * Check whether this crew has *already completed* the quiz
 * by looking for an existing quiz submission in the `submissions` tab.
 * This is the server-side hard lock (device-independent).
 */
async function hasCompletedQuiz(sheets, spreadsheetId, eventId, teamCode) {
  try {
    const res = await sheets.spreadsheets.values
      .get({ spreadsheetId, range: "submissions!A:Z" })
      .catch(() => null);

    const values = res?.data?.values || [];
    if (values.length <= 1) return false;

    const header = values[0].map((h) =>
      String(h || "").trim().toLowerCase()
    );
    const idxEvent = header.indexOf("event id");
    const idxTeam = header.indexOf("team code");
    const idxAct = header.indexOf("activity");
    const idxIdem = header.indexOf("idempotency");

    const idemKey = `quiz:${u(eventId)}:${u(teamCode)}`;

    return values.slice(1).some((row) => {
      // Prefer the explicit idempotency key
      if (idxIdem >= 0 && (row[idxIdem] || "") === idemKey) return true;

      // Fallback: match by Event + Team + Activity === "quiz"
      if (idxEvent >= 0 && idxTeam >= 0 && idxAct >= 0) {
        return (
          u(row[idxEvent] || "") === u(eventId) &&
          u(row[idxTeam] || "") === u(teamCode) &&
          String(row[idxAct] || "").trim().toLowerCase() === "quiz"
        );
      }

      return false;
    });
  } catch (e) {
    console.warn("hasCompletedQuiz check failed (allowing start):", e);
    // Fail-open: if the submissions sheet is missing/broken,
    // don't block the event entirely.
    return false;
  }
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return error(400, "Invalid JSON");
    }

    const eventId = norm(body.eventId || "");
    const teamCode = norm(body.teamCode || "");
    const teamName = norm(body.teamName || "");
    const quizStartTime = norm(body.quizStartTime || new Date().toISOString());

    if (!teamCode || !teamName) {
      return error(400, "Missing required fields: teamCode, teamName");
    }

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;
    if (!sheets) return error(500, "Spreadsheet client not available");

    // 🔒 Server-side lock: block crews who already have a FINAL quiz submission
    const alreadyDone = await hasCompletedQuiz(
      sheets,
      spreadsheetId,
      eventId,
      teamCode
    );
    if (alreadyDone) {
      // 409 so existing front-end mapping sees it as a conflict;
      // explicit code so you can branch on it in JS if you want.
      return error(409, "Quiz already completed for this crew.", {
        code: "ALREADY_COMPLETED",
      });
    }

    // From here on, it's just the original "start or resume" logic
    await ensureSheetExists(sheets, spreadsheetId);

    // Read existing rows
    const get = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A1:Z`,
    });
    const rows = get.data.values || [];
    const headers = rows[0] || HEADERS;
    const idx = headerIndexMap(headers);

    // Find row for THIS team (+ THIS event if provided)
    let foundRow = -1;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const code = norm(row[idx["Team Code"]] || "");
      const evt = norm(row[idx["Event Id"]] || "");
      const codeMatch = u(code) === u(teamCode);
      const eventMatch = eventId ? u(evt) === u(eventId) : true; // if no eventId provided, match by team only
      if (codeMatch && eventMatch) {
        foundRow = r;
        break;
      }
    }

    // If row exists and already has a start time → RESUME (200), not error
    if (foundRow > 0) {
      const existing = rows[foundRow] || [];
      const hasStart = norm(existing[idx["Quiz Start Time"]] || "");
      if (hasStart) {
        return ok({
          success: true,
          resume: true,
          quizStartTime: hasStart,
        });
      }

      // Otherwise, set start time on this row
      const out = new Array(Math.max(HEADERS.length, headers.length)).fill("");
      HEADERS.forEach((h) => {
        out[idx[h]] = existing[idx[h]] ?? "";
      });
      out[idx["Team Code"]] = teamCode;
      out[idx["Team Name"]] = teamName;
      out[idx["Quiz Start Time"]] = quizStartTime;
      if (eventId) out[idx["Event Id"]] = eventId;

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAME}!A${foundRow + 1}:Z${foundRow + 1}`,
        valueInputOption: "RAW",
        requestBody: { values: [out] },
      });

      return ok({ success: true, resume: false, quizStartTime });
    }

    // No row yet → append a fresh one
    const out = new Array(Math.max(HEADERS.length, headers.length)).fill("");
    out[idx["Team Code"]] = teamCode;
    out[idx["Team Name"]] = teamName;
    out[idx["Quiz Start Time"]] = quizStartTime;
    if (eventId) out[idx["Event Id"]] = eventId;

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [out] },
    });

    return ok({ success: true, resume: false, quizStartTime });
  } catch (e) {
    console.error("start_quiz_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
