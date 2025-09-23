// netlify/functions/get_leaderboard.js
const { ok, error, getSheets, SHEET_ID } = require("./_utils.js");

/** Helper: read a tab by any of a few likely titles. */
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

function activityKey(raw) {
  const k = String(raw || "").trim().toLowerCase();

  // existing buckets
  if (["kindness"].includes(k)) return "kindness";
  if (["limerick"].includes(k)) return "limerick";
  if (["scavenger", "hunt", "scav", "scavenger hunt"].includes(k)) return "scavenger";
  if (["quiz", "timed quiz", "the timed quiz"].includes(k)) return "quiz";

  // NEW: Clue Hunt (match several ways + fuzzy)
  if (
    ["clue hunt", "clue-hunt", "cluehunt", "clue"].includes(k) ||
    k.includes("clue") ||
    k.includes("treasure") // covers "treasure hunt" if you use that label
  ) {
    return "cluehunt";
  }

  return null; // unknown/ignored for breakdown (still counted in total if present)
}

exports.handler = async (event) => {
  try {
    // Allow both POST {eventId:"..."} and GET ?eventId=...
    const payload =
      event.httpMethod === "POST"
        ? (JSON.parse(event.body || "{}") || {})
        : Object.fromEntries(new URLSearchParams(event.queryStringParameters || {}));

    // Compute from Scores tab (no event filter here).
    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    // 1) Read Scores tab
    const { values: scoreRows } = await readTabValues(
      sheets,
      spreadsheetId,
      ["scores", "Scores", "scoreboard", "Scoreboard", "Points", "points", "Sheet1"]
    );

    if (!scoreRows.length) return ok({ leaderboard: [] });

    const header = scoreRows[0] || [];
    const idx = indexHeaders(header);
    // Expected headers include: Team Code, Activity, Score, Status
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
          quiz: 0,
          cluehunt: 0, // <-- NEW column
          total: 0,
        });
      }
      const agg = outByTeam.get(teamCode);
      if (act && Object.prototype.hasOwnProperty.call(agg, act)) {
        agg[act] += score;
      }
      // Always add to total (even if activity was unknown/future)
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

    // Output
    const leaderboard = [...outByTeam.values()]
      .map((t) => ({ ...t, teamName: t.teamName || t.teamCode }))
      .sort((a, b) => b.total - a.total);

    return ok({ leaderboard });
  } catch (e) {
    console.error("get_leaderboard error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
