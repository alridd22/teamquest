// /.netlify/functions/submit_cluehunt_function.js
const { ok, error, isPreflight, getSheets, SHEET_ID } = require("./_utils.js");

/* ---------- utilities ---------- */
async function ensureSheetWithHeader(sheets, spreadsheetId, title, headers) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some(s => s.properties?.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] }
    });
  }
  // only set header row if first row is empty/missing
  const h = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `${title}!1:1`
  }).catch(() => null);
  const hasHeader = !!(h?.data?.values?.[0]?.length);
  if (!hasHeader && headers?.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${title}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] }
    });
  }
}

function lcHeaders(row = []) {
  const out = {};
  (row || []).forEach((h, i) => (out[String(h || "").trim().toLowerCase()] = i));
  return out;
}
const normalize = (s='') => String(s).toLowerCase().trim().replace(/[^\w\s]/g,'').replace(/\s+/g,'');

/** read a whole tab (A:Z) */
async function readTab(sheets, spreadsheetId, title) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `${title}!A:Z`
  }).catch(() => null);
  const values = res?.data?.values || [];
  return { header: values[0] || [], rows: values.slice(1) };
}

/** detect Scores layout & row builder */
function makeScoresRowBuilder(scoresHeader) {
  const h = (scoresHeader || []).map(x => String(x||'').trim().toLowerCase());
  const isLegacy = h[0]==="team code" && h[1]==="activity" && h[2]==="score" && h[3]==="status";
  if (isLegacy) {
    // Team Code | Activity | Score | Status | SubmissionID | Event Id (may be missing as header)
    return ({ teamCode, activity, score, status, submissionId, eventId }) => ([
      teamCode, activity, Number(score)||0, status, submissionId, eventId || ""
    ]);
  }
  // New style, timestamp-first (fallback)
  return ({ teamCode, activity, score, status, submissionId, eventId }) => ([
    new Date().toISOString(), teamCode, activity, Number(score)||0, status.toUpperCase(), eventId || ""
  ]);
}

/** recompute team total for Clue Hunt from Scores */
async function computeTeamClueTotal(sheets, spreadsheetId, teamCode, eventId) {
  const { header, rows } = await readTab(sheets, spreadsheetId, "Scores");
  if (!header.length) return 0;
  const idx = lcHeaders(header);
  const iTeam = idx["team code"];
  const iAct  = idx["activity"];
  const iScore= idx["score"];
  const iEvt  = idx["event id"];            // may be undefined on legacy sheets
  const hasEvt = iEvt != null;
  if (iTeam == null || iAct == null || iScore == null) return 0;

  let sum = 0;
  for (const r of rows) {
    const act = String(r[iAct] || "").trim().toLowerCase();
    const code= String(r[iTeam]||"").trim();
    const evt = hasEvt ? String(r[iEvt]||"").trim() : "";
    // If there is NO Event Id column, don't filter by event at all
    if (code === teamCode && act === "clue" && (!hasEvt || !eventId || evt === eventId)) {
      sum += Number(r[iScore] || 0) || 0;
    }
  }
  return sum;
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
      mode,                // 'draft' | 'final' (default 'final')
      eventId,
      teamCode,
      teamName,
      clueId,
      clueText,
      userAnswer,
      correctAnswer,
      acceptableAnswers,   // optional array of synonyms
      pointsIfCorrect,     // preferred for new UI
      // backward-compat:
      points,              // old UI sent exact points (0 if wrong, 5..10 if right)
      currentScore,        // ignored server-side
    } = body || {};

    if (!teamCode || !clueId) {
      return error(400, "teamCode and clueId are required");
    }

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    // Ensure tabs we use exist
    await ensureSheetWithHeader(
      sheets, spreadsheetId, "submissions",
      ["Timestamp","Team Code","Activity","Nonce","Payload","AI Status","AI Attempts","AI Score","Final Score","Idempotency","Event Id"]
    );
    // Scores header: keep legacy if present, otherwise create new with legacy order
    const scoresHeaderRes = await sheets.spreadsheets.values.get({
      spreadsheetId, range: "Scores!1:1"
    }).catch(()=>null);
    if (!scoresHeaderRes || !(scoresHeaderRes.data?.values?.[0]?.length)) {
      await ensureSheetWithHeader(
        sheets, spreadsheetId, "Scores",
        ["Team Code","Activity","Score","Status","SubmissionID","Event Id"]
      );
    }
    const scoresHeader = (scoresHeaderRes?.data?.values?.[0]) || ["Team Code","Activity","Score","Status","SubmissionID","Event Id"];
    const buildScoresRow = makeScoresRowBuilder(scoresHeader);

    // ---- DRAFT MODE: write to a safe tab that doesn't affect totals/dedup ----
    if ((mode || "final").toLowerCase() === "draft") {
      await ensureSheetWithHeader(
        sheets, spreadsheetId, "clue_drafts",
        ["Timestamp","Event Id","Team Code","Clue Id","Draft Answer"]
      );
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "clue_drafts!A1",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: [[
            new Date().toISOString(),
            eventId || "",
            teamCode,
            Number(clueId)||0,
            String(userAnswer||"")
          ]]
        }
      });
      return ok({ success:true, draft:true });
    }

    // ---- FINAL MODE ----

    // Idempotency key (per team+clue+event)
    const idem = `clue:${eventId || ""}:${teamCode}:${clueId}`;

    // If already recorded in Scores, bail with current total
    {
      const { header, rows } = await readTab(sheets, spreadsheetId, "Scores");
      const idx = lcHeaders(header);
      const subIdIdx = (idx["submissionid"] != null ? idx["submissionid"] : idx["idempotency"]);
      if (subIdIdx != null) {
        const dup = rows.some(r => (r[subIdIdx] || "") === idem);
        if (dup) {
          const totalScore = await computeTeamClueTotal(sheets, spreadsheetId, teamCode, eventId);
          return ok({ success:true, deduped:true, awarded:0, correct:null, totalScore });
        }
      }
    }

    // Compute correctness server-side (prefer new fields; fallback to old)
    let awarded = 0;
    let correct = null;
    const nowIso = new Date().toISOString();

    if (points != null) {
      // Back-compat path – trust explicit points from legacy client
      awarded = Number(points) || 0;
      correct = awarded > 0;
    } else if (correctAnswer != null || Array.isArray(acceptableAnswers)) {
      const ua = normalize(userAnswer || "");
      const candidates = [];
      if (correctAnswer != null) candidates.push(normalize(String(correctAnswer)));
      if (Array.isArray(acceptableAnswers)) {
        for (const a of acceptableAnswers) candidates.push(normalize(String(a)));
      }
      correct = candidates.includes(ua);
      awarded = correct ? (Number(pointsIfCorrect)||0) : 0;
    } else {
      awarded = 0;
      correct = false;
    }

    // 1) Append detailed log to submissions
    const payload = JSON.stringify({
      activity: "clue",
      mode: "final",
      clueId: Number(clueId)||0,
      clueText: String(clueText||""),
      userAnswer: String(userAnswer||""),
      correctAnswer: String(correctAnswer||""),
      acceptableAnswers: Array.isArray(acceptableAnswers) ? acceptableAnswers : [],
      pointsIfCorrect: Number(pointsIfCorrect)||0,
      awarded,
      correct,
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
          nowIso,            // Timestamp
          teamCode,          // Team Code
          "clue",            // Activity
          "",                // Nonce
          payload,           // Payload
          "FINAL",           // AI Status
          "0",               // AI Attempts
          "",                // AI Score
          awarded,           // Final Score (this attempt)
          idem,              // Idempotency
          eventId || ""      // Event Id
        ]]
      }
    });

    // 2) Append to Scores (layout-aware)
    const scoresRow = buildScoresRow({
      teamCode, activity: "clue", score: awarded, status: "final", submissionId: idem, eventId: eventId || ""
    });
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Scores!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [scoresRow] }
    });

    // 3) Recompute total
    const totalScore = await computeTeamClueTotal(sheets, spreadsheetId, teamCode, eventId);

    return ok({
      success: true,
      message: "Clue recorded",
      awarded,
      correct,
      attemptTime: nowIso,
      totalScore
    });

  } catch (e) {
    console.error("submit_cluehunt_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
