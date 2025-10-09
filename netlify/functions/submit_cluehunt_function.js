// netlify/functions/submit_cluehunt_function.js
const { ok, error, isPreflight, getSheets, SHEET_ID } = require("./_utils.js");

/* ---------- helpers ---------- */

function lcHeaders(row = []) {
  const out = {};
  (row || []).forEach((h, i) => (out[String(h || "").trim().toLowerCase()] = i));
  return out;
}

async function ensureSheetWithHeader(sheets, spreadsheetId, title, headers) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some(s => s.properties?.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] }
    });
  }
  if (headers?.length) {
    // Merge: if header missing or shorter, write/extend it
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId, range: `${title}!A1:Z1`
    }).catch(() => null);
    const cur = res?.data?.values?.[0] || [];
    if (cur.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: `${title}!A1`,
        valueInputOption: "RAW", requestBody: { values: [headers] }
      });
    } else {
      const need = headers.filter(h => !cur.includes(h));
      if (need.length) {
        const next = cur.concat(need);
        await sheets.spreadsheets.values.update({
          spreadsheetId, range: `${title}!A1`,
          valueInputOption: "RAW", requestBody: { values: [next] }
        });
      }
    }
  }
}

async function readTab(sheets, spreadsheetId, title) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `${title}!A:Z`
  }).catch(() => null);
  const values = res?.data?.values || [];
  return { header: values[0] || [], rows: values.slice(1) };
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, "");
}

function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function activityKey(raw = "") {
  const k = String(raw || "").trim().toLowerCase();
  if (["clue hunt", "cluehunt", "clue", "treasure", "treasure hunt"].includes(k)) return "cluehunt";
  return null;
}

/* ---------- scores sheet compatibility ---------- */

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
  // Newer layout (prepend Timestamp)
  return (teamCode, activity, score, status, submissionId, eventId) => ([
    new Date().toISOString(), teamCode, activity, Number(score) || 0, status, eventId || ""
  ]);
}

/* ---------- handler ---------- */

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return error(400, "Invalid JSON"); }

    const {
      mode = "final",            // "draft" or "final"
      eventId = "",              // strongly recommended (required for idempotency)
      teamCode,
      teamName = "",
      clueId,                    // number 1..20
      clueText = "",
      userAnswer = "",
      correctAnswer = "",
      pointsIfCorrect,           // number (reward if correct)
    } = body || {};

    if (!teamCode || !clueId) {
      return error(400, "Missing required fields: teamCode, clueId");
    }

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    /* ---- Draft autosave: write to separate tab, never affects score ---- */
    if (String(mode).toLowerCase() === "draft") {
      await ensureSheetWithHeader(
        sheets, spreadsheetId, "cluehunt_drafts",
        ["Timestamp", "Event Id", "Team Code", "Clue Id", "User Answer"]
      );
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "cluehunt_drafts!A:E",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [[
          new Date().toISOString(),
          eventId || "",
          teamCode,
          Number(clueId) || 0,
          String(userAnswer || "")
        ]]}
      });
      return ok({ success: true, saved: true });
    }

    /* ---- Final submission (one try) ---- */

    // Ensure submissions sheet has a modern header
    const requiredCols = [
      "Timestamp","Team Code","Team Name","Activity",
      "Clue Id","Clue Text","User Answer","Correct Answer",
      "Final Score","Status","Idempotency","Event Id"
    ];
    await ensureSheetWithHeader(sheets, spreadsheetId, "submissions", requiredCols);

    // Ensure Scores sheet exists (legacy consumers)
    await ensureSheetWithHeader(
      sheets, spreadsheetId, "Scores",
      ["Team Code","Activity","Score","Status","SubmissionID","Event Id"]
    );

    const { header: subHeader, rows: subRows } = await readTab(sheets, spreadsheetId, "submissions");
    const subIdx = lcHeaders(subHeader);

    // Add any missing columns gracefully
    const missing = requiredCols.filter(c => subIdx[c.toLowerCase()] == null);
    if (missing.length) {
      const next = subHeader.concat(missing);
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: "submissions!A1",
        valueInputOption: "RAW", requestBody: { values: [next] }
      });
      // refresh indices
      for (const [i, h] of next.entries()) subIdx[h.toLowerCase()] = i;
    }

    // Idempotency
    const idem = `clue:${(eventId || "").toUpperCase()}:${teamCode.toUpperCase()}:${Number(clueId) || 0}`;

    // Duplicate check (prefer exact clue row match; fallback to idempotency col)
    let existing = null;
    const iTeam  = subIdx["team code"],  iEvt = subIdx["event id"], iClue = subIdx["clue id"];
    const iScore = subIdx["final score"], iTs = subIdx["timestamp"], iAct = subIdx["activity"];
    const iStat  = subIdx["status"], iIdem = subIdx["idempotency"];

    for (const r of subRows) {
      const act = activityKey(r[iAct] || "");
      if (act !== "cluehunt") continue;

      const sameTeam = ((r[iTeam] || "").toString().trim().toUpperCase() === teamCode.toUpperCase());
      if (!sameTeam) continue;

      // If Event Id column exists, enforce it; otherwise accept any
      const sameEvent = !iEvt || ((r[iEvt] || "").toString().trim().toUpperCase() === (eventId || "").toUpperCase());
      if (!sameEvent) continue;

      const sameClue = Number(r[iClue] || 0) === Number(clueId);
      const sameIdem = iIdem != null && (r[iIdem] || "") === idem;

      if (sameClue || sameIdem) {
        existing = {
          awarded: toNum(r[iScore], 0),
          correct: toNum(r[iScore], 0) > 0,
          attemptTime: r[iTs] || new Date().toISOString()
        };
        break;
      }
    }

    if (existing) {
      // Compute team total (FINAL only)
      let total = 0;
      for (const r of subRows) {
        const act = activityKey(r[iAct] || "");
        if (act !== "cluehunt") continue;
        const sameTeam = ((r[iTeam] || "").toString().trim().toUpperCase() === teamCode.toUpperCase());
        if (!sameTeam) continue;
        const sameEvent = !iEvt || ((r[iEvt] || "").toString().trim().toUpperCase() === (eventId || "").toUpperCase());
        if (!sameEvent) continue;
        const status = ((iStat != null ? r[iStat] : "FINAL") || "FINAL").toString().toUpperCase();
        if (status !== "FINAL") continue;
        total += toNum(r[iScore], 0);
      }
      return ok({ success:true, idempotent:true, ...existing, totalScore: total });
    }

    // Evaluate correctness defensively on the server (given expected answer)
    const correct = norm(userAnswer) && norm(userAnswer) === norm(correctAnswer);
    const awarded = correct ? toNum(pointsIfCorrect, 0) : 0;
    const ts = new Date().toISOString();

    // Build a row aligned to detected indices
    const subRow = [];
    subRow[subIdx["timestamp"]]      = ts;
    subRow[subIdx["team code"]]      = teamCode;
    subRow[subIdx["team name"]]      = teamName || teamCode;
    subRow[subIdx["activity"]]       = "Clue Hunt";
    subRow[subIdx["clue id"]]        = Number(clueId);
    subRow[subIdx["clue text"]]      = String(clueText || "");
    subRow[subIdx["user answer"]]    = String(userAnswer || "");
    subRow[subIdx["correct answer"]] = String(correctAnswer || "");
    subRow[subIdx["final score"]]    = awarded;
    subRow[subIdx["status"]]         = "FINAL";
    subRow[subIdx["idempotency"]]    = idem;
    if (subIdx["event id"] != null) subRow[subIdx["event id"]] = eventId || "";

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "submissions!A:Z",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [subRow] }
    });

    // Legacy: also append to Scores for backwards compatibility
    const { header: scoresHeader } = await readTab(sheets, spreadsheetId, "Scores");
    const buildScoresRow = makeScoresRowBuilder(scoresHeader);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Scores!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [buildScoresRow(teamCode, "clue", awarded, "final", idem, eventId || "")] }
    });

    // Recompute total
    const { rows: subRows2 } = await readTab(sheets, spreadsheetId, "submissions");
    let totalScore = 0;
    for (const r of subRows2) {
      const act = activityKey(r[iAct] || "");
      if (act !== "cluehunt") continue;
      const sameTeam = ((r[iTeam] || "").toString().trim().toUpperCase() === teamCode.toUpperCase());
      if (!sameTeam) continue;
      const sameEvent = !iEvt || ((r[iEvt] || "").toString().trim().toUpperCase() === (eventId || "").toUpperCase());
      if (!sameEvent) continue;
      const status = ((iStat != null ? r[iStat] : "FINAL") || "FINAL").toString().toUpperCase();
      if (status !== "FINAL") continue;
      totalScore += toNum(r[iScore], 0);
    }

    return ok({
      success: true,
      correct,
      awarded,
      attemptTime: ts,
      totalScore
    });

  } catch (e) {
    console.error("submit_cluehunt_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
