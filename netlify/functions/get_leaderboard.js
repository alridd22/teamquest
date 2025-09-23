// netlify/functions/get_leaderboard.js
const { ok, error, getSheets, SHEET_ID } = require("./_utils.js");

/** Read the first tab that exists from a list of likely names */
async function readTabValues(sheets, spreadsheetId, tabNames, range = "A1:Z9999") {
  for (const name of tabNames) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${name}!${range}`,
      });
      const values = res?.data?.values || [];
      if (values.length) return { name, values };
    } catch (_) { /* try next */ }
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

/** Map messy activity labels to canonical keys used for columns */
function activityKey(raw) {
  const k = String(raw || "").trim().toLowerCase();

  if (["kindness"].includes(k)) return "kindness";
  if (["limerick"].includes(k)) return "limerick";
  if (["scavenger", "hunt", "scav", "scavenger hunt"].includes(k)) return "scavenger";
  if (["clue", "cluehunt", "clue hunt", "treasure", "treasure hunt"].includes(k)) return "clue";
  if (["quiz", "timed quiz", "the timed quiz"].includes(k)) return "quiz";

  return null; // unknown/ignored for per-column, still counted in total
}

exports.handler = async (event) => {
  try {
    // Allow POST {eventId:"..."} or GET ?eventId=... (we don't filter by event)
    const payload = event.httpMethod === "POST"
      ? (JSON.parse(event.body || "{}") || {})
      : (Object.fromEntries(new URLSearchParams(event.queryStringParameters || {})));

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    // 1) Read Scores
    const { values: scoreRows } = await readTabValues(
      sheets,
      spreadsheetId,
      ["scores", "Scores", "scoreboard", "Scoreboard", "Points", "points", "Sheet1"]
    );

    if (!scoreRows.length) return ok({ leaderboard: [] });

    const header = scoreRows[0] || [];
    const idx = indexHeaders(header);

    // Expected headers: Team Code | Activity | Score | Status (case-insensitive)
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
          clue: 0,        // <<< NEW COLUMN
          quiz: 0,
          total: 0,
        });
      }

      const agg = outByTeam.get(teamCode);
      if (act && Object.prototype.hasOwnProperty.call(agg, act)) {
        agg[act] += score;    // put into its column
      }
      agg.total += score;     // always accumulates into Total
    }

    // 2) Merge team names from Teams tab
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

    const leaderboard = [...outByTeam.values()]
      .map(t => ({ ...t, teamName: t.teamName || t.teamCode }))
      .sort((a, b) => b.total - a.total);

    return ok({ leaderboard });
  } catch (e) {
    console.error("get_leaderboard error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
