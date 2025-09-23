// netlify/functions/get_leaderboard.js
const { ok, error, getSheets, SHEET_ID } = require("./_utils.js");

/**
 * Helper: read a tab by any of a few likely titles.
 */
async function readTabValues(sheets, spreadsheetId, tabNames, range = "A1:Z9999") {
  for (const name of tabNames) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${name}!${range}`,
      });
      const values = res?.data?.values || [];
      if (values.length) return { name, values };
    } catch (e) {
      // try next
    }
  }
  return { name: null, values: [] };
}

function indexHeaders(row = []) {
  const idx = {};
  row.forEach((h, i) => {
    const key = String(h || "").trim().toLowerCase();
    if (key) idx[key] = i;
  });
  return idx;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Map sheet "Activity" values to leaderboard keys
function activityKey(raw) {
  const k = String(raw || "").trim().toLowerCase();
  if (["kindness"].includes(k)) return "kindness";
  if (["limerick"].includes(k)) return "limerick";
  if (["scavenger", "hunt", "scav", "scavenger hunt"].includes(k)) return "scavenger";
  // NEW: treat "clue" (and variants) as Clue Hunt column
  if (["clue", "clue hunt", "cluehunt", "clue-hunt"].includes(k)) return "cluehunt";
  if (["quiz", "timed quiz", "the timed quiz"].includes(k)) return "quiz";
  return null; // unknown/ignored for breakdown (still added to total below)
}

exports.handler = async (event) => {
  try {
    // Allow both POST {eventId:"..."} and GET ?eventId=...
    const payload =
      event.httpMethod === "POST"
        ? (JSON.parse(event.body || "{}") || {})
        : Object.fromEntries(new URLSearchParams(event.queryStringParameters || {}));

    // Even if an eventId is passed, we compute from the Scores tab
    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    // 1) Read Scores tab (various likely names)
    const { values: scoreRows } = await readTabValues(
      sheets,
      spreadsheetId,
      ["scores", "Scores", "scoreboard", "Scoreboard", "Points", "points", "Sheet1"]
    );

    if (!scoreRows.length) {
      return ok({ leaderboard: [] }); // nothing to show
    }

    const header = scoreRows[0] || [];
    const idx = indexHeaders(header);
    // Expected headers (case-insensitive): Team Code, Activity, Score, Status
    const outByTeam = new Map();

    for (let i = 1; i < scoreRows.length; i++) {
      const row = scoreRows[i] || [];
      const teamCode = (row[idx["team code"]] || row[idx["team"]] || "").trim();
      if (!teamCode) continue;

      const status = String(row[idx["status"]] || "").trim().toLowerCase();
      if (status && status !== "final") continue; // only final rows

      const act = activityKey(row[idx["activity"]]);
      const score = num(row[idx["score"]]);

      if (!outByTeam.has(teamCode)) {
        outByTeam.set(teamCode, {
          teamCode,
          teamName: "", // filled from Teams sheet below
          kindness: 0,
          limerick: 0,
          scavenger: 0,
          cluehunt: 0, // NEW column
          quiz: 0,
          total: 0,
        });
      }
      const agg = outByTeam.get(teamCode);
      if (act && Object.prototype.hasOwnProperty.call(agg, act)) {
        agg[act] += score;
      }
      // Always add to total, even if the activity is not one of the tracked buckets
      agg.total += score;
    }

    // 2) Merge team names from Teams tab (if available)
    const { values: teamRows } = await readTabValues(
      sheets,
      spreadsheetId,
      ["teams", "Teams", "Team List", "team_list", "teamlist"]
    );

    if (teamRows.length) {
      const h2 = indexHeaders(teamRows[0] || []);
      const codeIdx = h2["team code"] ?? h2["code"] ?? h2["team"] ?? null;
      const nameIdx = h2["team name"] ?? h2["name"] ?? null;

      if (codeIdx != null && nameIdx != null) {
        for (let i = 1; i < teamRows.length; i++) {
          const r = teamRows[i] || [];
          const code = String(r[codeIdx] || "").trim();
          const name = String(r[nameIdx] || "").trim();
          if (!code || !name) continue;
          const agg = outByTeam.get(code);
          if (agg) agg.teamName = name;
        }
      }
    }

    // If a teamName wasn’t found, fallback to code
    const leaderboard = [...outByTeam.values()]
      .map((t) => ({ ...t, teamName: t.teamName || t.teamCode }))
      .sort((a, b) => b.total - a.total);

    // Final, stable shape
    return ok({ leaderboard });
  } catch (e) {
    console.error("get_leaderboard error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
