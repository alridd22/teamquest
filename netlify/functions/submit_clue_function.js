// netlify/functions/submit_clue_function.js
const {
  ok, error, isPreflight,
  getSheets, tabRange, SHEET_ID
} = require("./_utils.js");

/* --------- Normalisation & compare (forgiving matches) --------- */
const norm = (s) => String(s ?? "")
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "")  // strip spaces, commas, punctuation
  .trim();

function isMatch(user, expected) {
  const u = norm(user);

  // allow pipe-separated variants in the sheet: "E O | EO"
  const variants = String(expected || "")
    .split("|")
    .map(x => x.trim())
    .filter(Boolean);

  const list = variants.length ? variants : [expected];

  // exact (after normalization)
  for (const v of list) {
    if (u === norm(v)) return true;
  }

  // numeric equivalence: "1,908" === "1908"
  const numU = (user || "").replace(/[^\d.-]/g, "");
  for (const v of list) {
    const numV = (v || "").replace(/[^\d.-]/g, "");
    if (numU && numV && !isNaN(+numU) && !isNaN(+numV) && +numU === +numV) {
      return true;
    }
  }
  return false;
}

/* --------- Sheet helpers --------- */
async function getClueBank(sheets, ssid) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: ssid, range: tabRange("ClueBank", "A:C"),
  });
  const v = r.data.values || [];
  const head = v[0] || [];
  const idx = {}; head.forEach((h, i) => (idx[h] = i));
  const rows = v.slice(1).map(row => ({
    ClueID: row[idx["ClueID"]] ?? row[0] ?? "",
    Answer: row[idx["CorrectAnswer"]] ?? row[1] ?? "",
    Points: Number(row[idx["Points"]] ?? row[2] ?? 0),
  }));
  const byId = new Map();
  rows.forEach(r => { if (r.ClueID) byId.set(String(r.ClueID), r); });
  return byId;
}

async function getExistingScoreForIdem(sheets, ssid, idem) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: ssid, range: tabRange("Scores", "A:E"),
  });
  const vals = r.data.values || [];
  for (let i = 1; i < vals.length; i++) {
    if ((vals[i][4] || "") === idem) {
      return Number(vals[i][2] || 0); // column C = Score
    }
  }
  return null;
}

/* --------- Handler --------- */
module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST") return error(405, "POST only");

    let body = {};
    try { body = JSON.parse(event.body || "{}"); }
    catch { return error(400, "Invalid JSON"); }

    const teamCode = (body.teamCode || "").trim();
    const clueId   = (body.clueId   || "").trim();
    const answer   = (body.answer   || "").trim();

    if (!teamCode || !clueId || !answer) {
      return error(400, "teamCode, clueId, answer are required");
    }

    const sheets = await getSheets();
    const ssid = SHEET_ID;

    // read clue
    const bank = await getClueBank(sheets, ssid);
    const clue = bank.get(clueId);
    if (!clue) return error(404, `Unknown clueId ${clueId}`);

    const submissionId = `clue-${teamCode}-${clueId}`; // idempotency

    // If already scored, return same score so UI can reveal points consistently
    const prior = await getExistingScoreForIdem(sheets, ssid, submissionId);
    if (prior !== null) {
      return ok({
        success: true,
        alreadySubmitted: true,
        submissionId,
        correct: prior > 0,
        pointsAwarded: prior,
        pointsPossible: Number(clue.Points) || 0,
      });
    }

    // Evaluate
    const correct = isMatch(answer, clue.Answer);
    const pointsPossible = Number(clue.Points) || 0;
    const pointsAwarded = correct ? pointsPossible : 0;

    // Append to submissions
    const timestamp = new Date().toISOString();
    await sheets.spreadsheets.values.append({
      spreadsheetId: ssid,
      range: tabRange("submissions", "A1"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[
        timestamp,                // Timestamp
        teamCode,                 // Team Code
        "clue",                   // Activity
        clueId,                   // Nonce (we store the ClueID here)
        JSON.stringify({
          clueId,
          givenAnswer: answer,
          expected: clue.Answer,
          pointsPossible
        }),
        "FINAL",                  // AI Status (we treat it as instantly final)
        "0",                      // AI Attempts
        correct ? "1" : "0",      // AI Score (1/0)
        String(pointsAwarded),    // Final Score
        submissionId,             // Idempotency
        ""                        // Event Id
      ]]}
    });

    // Append to Scores
    await sheets.spreadsheets.values.append({
      spreadsheetId: ssid,
      range: tabRange("Scores", "A1"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [[
        teamCode, "clue", String(pointsAwarded), "final", submissionId
      ]]}
    });

    return ok({
      success: true,
      submissionId,
      correct,
      pointsAwarded,
      pointsPossible
    });
  } catch (e) {
    console.error("submit_clue_function:", e);
    return error(500, e.message || "Unexpected error");
  }
};
