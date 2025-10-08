// netlify/functions/get_leaderboard.js
const { ok, error, getSheets, SHEET_ID } = require("./_utils.js");

/** Read a tab by any of a few likely titles. */
async function readTabValues(sheets, spreadsheetId, tabNames, range = "A1:Z9999") {
  for (const name of tabNames) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${name}!${range}`,
      });
      const values = res?.data?.values || [];
      if (values.length) return { name, values };
    } catch {}
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

const num   = (v) => (Number.isFinite(+v) ? +v : 0);
const norm  = (s) => String(s ?? "").trim();
const lower = (s) => norm(s).toLowerCase();
const upper = (s) => norm(s).toUpperCase();

// activity -> bucket mapping (keeps your buckets + common aliases)
function activityKey(raw) {
  const k = lower(raw);
  if (["kindness", "the kindness challenge"].includes(k)) return "kindness";
  if (["limerick", "the limerick challenge"].includes(k)) return "limerick";
  if (["scavenger", "scav", "scavenger hunt", "the scavenger hunt"].includes(k)) return "scavenger";
  if (["clue", "clue hunt", "cluehunt", "clue-hunt", "the clue hunt"].includes(k)) return "cluehunt";
  if (["quiz", "timed quiz", "the timed quiz", "the quiz"].includes(k)) return "quiz";
  return null;
}

exports.handler = async (event) => {
  try {
    // Accept POST or GET; support ?eventId= or ?event=
    const payload = event.httpMethod === "POST"
      ? (JSON.parse(event.body || "{}") || {})
      : Object.fromEntries(new URLSearchParams(event.queryStringParameters || {}));
    const eventIdFilter = upper(payload.eventId || payload.event || "");

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    // Prefer Submissions (Final Score lives here)
    const { values: subRows } = await readTabValues(
      sheets,
      spreadsheetId,
      ["submissions", "Submissions", "SUBMISSIONS"]
    );

    let outByTeam = new Map();

    if (subRows.length) {
      const header = subRows[0] || [];
      const idx = indexHeaders(header);

      // Submissions columns (case-insensitive)
      const iTs    = idx["timestamp"];
      const iCode  = idx["team code"] ?? idx["team"];
      const iAct   = idx["activity"];
      const iStat  = idx["ai status"] ?? idx["status"];
      const iFinal = idx["final score"] ?? idx["score"];
      const iIdem  = idx["idempotency"] ?? idx["submissionid"];
      const iEvt   = idx["event id"] ?? idx["eventid"];

      // Deduplicate by Idempotency using MAX Final Score (tie-break by latest timestamp)
      const idemBest = new Map(); // idemKey -> {score, ts, row}
      for (let r = 1; r < subRows.length; r++) {
        const row = subRows[r] || [];
        const status = lower(row[iStat] || "");
        if (!status.includes("final")) continue;

        if (eventIdFilter && upper(row[iEvt] || "") !== eventIdFilter) continue;

        const code = upper(row[iCode] || "");
        const bucket = activityKey(row[iAct]);
        if (!code || !bucket) continue;

        const score = num(row[iFinal]);
        const ts = new Date(row[iTs] || 0).getTime() || 0;

        // Prefer Idempotency; if absent, synthesize a unique key
        const rawIdem = norm(row[iIdem] || "");
        const idemKey = rawIdem || `NOIDEM:${code}:${bucket}:${ts}`;

        const prev = idemBest.get(idemKey);
        if (!prev || score > prev.score || (score === prev.score && ts >= prev.ts)) {
          idemBest.set(idemKey, { score, ts, row });
        }
      }

      // Aggregate per team/activity
      outByTeam = new Map();
      for (const { row, score } of idemBest.values()) {
        const teamCode = norm(row[iCode] || "");
        if (!teamCode) continue;
        const bucket = activityKey(row[iAct]);
        if (!bucket) continue;

        if (!outByTeam.has(teamCode)) {
          outByTeam.set(teamCode, {
            teamCode,
            teamName: "",
            kindness: 0,
            limerick: 0,
            scavenger: 0,
            cluehunt: 0,
            quiz: 0,
            total: 0,
          });
        }
        const agg = outByTeam.get(teamCode);
        agg[bucket] += score;
        agg.total += score;
      }
    } else {
      // Fallback: your existing Scores-based logic (unchanged)
      const { values: scoreRows } = await readTabValues(
        sheets,
        spreadsheetId,
        ["scores", "Scores", "scoreboard", "Scoreboard", "Points", "points", "Sheet1"]
      );
      if (!scoreRows.length) return ok({ leaderboard: [] });

      const header = scoreRows[0] || [];
      const idx = indexHeaders(header);
      outByTeam = new Map();

      for (let i = 1; i < scoreRows.length; i++) {
        const row = scoreRows[i] || [];
        const teamCode = (row[idx["team code"]] || row[idx["team"]] || "").trim();
        if (!teamCode) continue;

        const status = String(row[idx["status"]] || "").trim().toLowerCase();
        if (status && status !== "final") continue;

        const act = activityKey(row[idx["activity"]]);
        const score = num(row[idx["score"]]);

        if (!outByTeam.has(teamCode)) {
          outByTeam.set(teamCode, {
            teamCode,
            teamName: "",
            kindness: 0,
            limerick: 0,
            scavenger: 0,
            cluehunt: 0,
            quiz: 0,
            total: 0,
          });
        }
        const agg = outByTeam.get(teamCode);
        if (act && Object.prototype.hasOwnProperty.call(agg, act)) {
          agg[act] += score;
        }
        agg.total += score;
      }
    }

    // Merge team names from Teams/teams_public tab (same as before)
    const { values: teamRows } = await readTabValues(
      sheets,
      spreadsheetId,
      ["teams", "Teams", "Team List", "team_list", "teamlist", "teams_public", "Teams_Public"]
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
      .map((t) => ({ ...t, teamName: t.teamName || t.teamCode }))
      .sort((a, b) => b.total - a.total || String(a.teamName).localeCompare(String(b.teamName)));

    return ok({ leaderboard });
  } catch (e) {
    console.error("get_leaderboard error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
