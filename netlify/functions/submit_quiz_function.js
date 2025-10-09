const { ok, error, isPreflight, getSheets, SHEET_ID, readRange, tabRange } = require("./_utils.js");

function lcIdx(header = []) {
  const out = {};
  header.forEach((h, i) => (out[String(h || "").trim().toLowerCase()] = i));
  return out;
}
const norm = (s) => String(s ?? "").trim();
const u    = (s) => norm(s).toUpperCase();

/** Ensure a sheet exists and, if absent, seed its header (non-destructive if present). */
async function ensureSheetWithHeader(sheets, spreadsheetId, title, headers) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets || []).some(s => s.properties?.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] }
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${title}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] }
    });
  }
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return error(400, "Invalid JSON body"); }

    const rawEventId   = body.eventId;
    const rawTeamCode  = body.teamCode;
    const teamName     = norm(body.teamName || "");
    const totalScore   = Number(body.totalScore || 0) || 0;
    const questionsCorrect = Number(body.questionsCorrect || 0) || 0;
    const totalQuestions   = Number(body.totalQuestions || 0) || 0;
    const completionTime   = norm(body.completionTime || "");
    const quizStartTime    = norm(body.quizStartTime || "");
    const answers          = Array.isArray(body.answers) ? body.answers : [];

    if (!rawTeamCode || body.totalScore == null || body.totalQuestions == null) {
      return error(400, "teamCode, totalScore and totalQuestions are required");
    }

    const eventId  = u(rawEventId || "");
    const teamCode = u(rawTeamCode);

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    // Ensure tabs exist
    await ensureSheetWithHeader(
      sheets, spreadsheetId, "submissions",
      ["Timestamp","Team Code","Activity","Nonce","Payload","AI Status","AI Attempts","AI Score","Final Score","Idempotency","Event Id"]
    );

    // Read Scores header (don’t trample existing layout)
    const scoresHeaderRes = await sheets.spreadsheets.values.get({
      spreadsheetId, range: "Scores!1:1"
    }).catch(() => null);
    if (!scoresHeaderRes || !(scoresHeaderRes.data?.values?.[0]?.length)) {
      await ensureSheetWithHeader(
        sheets, spreadsheetId, "Scores",
        ["Team Code","Activity","Score","Status","SubmissionID","Event Id"]
      );
    }
    const scoresHdr = (scoresHeaderRes?.data?.values?.[0] || []).map(s => String(s).trim().toLowerCase());
    const isLegacyScores = scoresHdr[0] === "team code" && scoresHdr[1] === "activity" && scoresHdr[2] === "score";

    const nowIso = new Date().toISOString();
    const pct = Math.round((questionsCorrect / Math.max(1, totalQuestions)) * 100);
    const idem = `quiz:${eventId}:${teamCode}`;

    // --- Idempotency guard (submissions first) ---
    try {
      const sub = await sheets.spreadsheets.values.get({ spreadsheetId, range: "submissions!A:Z" }).catch(() => null);
      const sv  = sub?.data?.values || [];
      if (sv.length > 1) {
        const i = lcIdx(sv[0] || []);
        const idIdx = i["idempotency"], evtIdx = i["event id"], teamIdx = i["team code"], actIdx = i["activity"];
        const dup = sv.slice(1).some(r =>
          (idIdx != null && (r[idIdx] || "") === idem) ||
          (evtIdx != null && teamIdx != null && actIdx != null &&
           u(r[evtIdx] || "") === eventId && u(r[teamIdx] || "") === teamCode &&
           String(r[actIdx] || "").toLowerCase().includes("quiz"))
        );
        if (dup) return ok({ success: true, idempotent: true, message: "Quiz already recorded" });
      }
    } catch {}

    // 1) Append detailed row to submissions
    const payload = JSON.stringify({
      activity: "quiz",
      teamName,
      questionsCorrect,
      totalQuestions,
      percentage: String(pct),
      completion: "FINAL",
      completionTime: completionTime || nowIso,
      quizStartTime,
      answers
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "submissions!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          nowIso,               // Timestamp
          teamCode,             // Team Code (normalized)
          "quiz",               // Activity
          "",                   // Nonce
          payload,              // Payload
          "FINAL",              // AI Status
          "0",                  // AI Attempts
          "",                   // AI Score
          totalScore,           // Final Score
          idem,                 // Idempotency
          eventId               // Event Id (normalized)
        ]]
      }
    });

    // 2) Append to Scores (avoid dup by checking SubmissionID/Event+Team when legacy)
    if (isLegacyScores) {
      const scoresSheet = await sheets.spreadsheets.values.get({ spreadsheetId, range: "Scores!A:Z" }).catch(() => null);
      const sv = scoresSheet?.data?.values || [];
      let duplicate = false;
      if (sv.length > 1) {
        const i = lcIdx(sv[0] || []);
        const subId = i["submissionid"], evt = i["event id"], team = i["team code"], act = i["activity"];
        duplicate = sv.slice(1).some(r =>
          (subId != null && (r[subId] || "") === idem) ||
          (evt != null && team != null && act != null &&
           u(r[evt] || "") === eventId && u(r[team] || "") === teamCode &&
           String(r[act] || "").toLowerCase() === "quiz")
        );
      }
      if (!duplicate) {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: "Scores!A1",
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: [[teamCode, "quiz", totalScore, "final", idem, eventId]] }
        });
      }
    } else {
      // Newer layout: Timestamp first
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "Scores!A1",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [[nowIso, teamCode, "quiz", totalScore, "FINAL", eventId]] }
      });
    }

    // 3) Mark team quiz state as ENDED (optional but helpful)
    try {
      const tv = await readRange(sheets, spreadsheetId, tabRange("teams", "A:Z"));
      if (tv.length) {
        const hdr = tv[0] || [];
        const i = {};
        hdr.forEach((h, idx) => (i[String(h || "").trim()] = idx));
        const iEvent = i["Event Id"], iCode = i["Team Code"];
        const iQState = i["QuizState"], iQDone = i["QuizCompletedAt (ISO)"], iQEnd = i["QuizEndsAt (ISO)"];
        const rIndex = tv.slice(1).findIndex(r => u(r[iEvent] || "") === eventId && u(r[iCode] || "") === teamCode);
        if (rIndex >= 0 && iQState != null) {
          const rowNum = rIndex + 2;
          const row = tv[rIndex + 1];
          const out = [...row];
          out[iQState] = "ENDED";
          if (iQDone != null) out[iQDone] = nowIso;
          if (iQEnd  != null && !out[iQEnd]) out[iQEnd] = nowIso;
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `teams!A${rowNum}:Z${rowNum}`,
            valueInputOption: "RAW",
            requestBody: { values: [out] }
          });
        }
      }
    } catch {}

    return ok({ success: true, recorded: true, totalScore, questionsCorrect, totalQuestions });
  } catch (e) {
    console.error("submit_quiz_function error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
