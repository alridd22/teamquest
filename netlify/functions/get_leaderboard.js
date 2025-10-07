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
    } catch { /* try next */ }
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

// Map sheet "Activity" values to leaderboard keys (kept from your version)
function activityKey(raw) {
  const k = String(raw || "").trim().toLowerCase();
  if (["kindness"].includes(k)) return "kindness";
  if (["limerick"].includes(k)) return "limerick";
  if (["scavenger", "hunt", "scav", "scavenger hunt"].includes(k)) return "scavenger";
  if (["clue", "clue hunt", "cluehunt", "clue-hunt"].includes(k)) return "cluehunt";
  if (["quiz", "timed quiz", "the timed quiz"].includes(k)) return "quiz";
  return null; // unknown/ignored for breakdown (still added to total)
}

exports.handler = async (event) => {
  try {
    // Allow both POST {eventId:"..."} and GET ?eventId=... (and ?event=...)
    const payload =
      event.httpMethod === "POST"
        ? (JSON.parse(event.body || "{}") || {})
        : Object.fromEntries(new URLSearchParams(event.queryStringParameters || {}));
    const eventIdFilter = String(payload.eventId || payload.event || "").trim();

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    // ---- PREFERRED: read from Submissions (your AI writes Final Score here) ----
    const { values: subRows } = await readTabValues(
      sheets,
      spreadsheetId,
      ["submissions", "Submissions", "SUBMISSIONS"]
    );

    let outByTeam = new Map();

    if (subRows.length) {
      const header = subRows[0] || [];
      const idx = indexHeaders(header);

      // Column names as seen in your screenshots (case-insensitive):
      // "Timestamp" | "Team Code" | "Activity" | "AI Status" | "Final Score" | "Idempotency" | "Event Id"
      const iTimestamp   = idx["timestamp"];
      const iTeamCode    = idx["team code"] ?? idx["team"];
      const iActivity    = idx["activity"];
      const iAiStatus    = idx["ai status"] ?? idx["status"];
      const iFinalScore  = idx["final score"] ?? idx["score"];
      const iIdempotency = idx["idempotency"] ?? idx["submissionid"];
      const iEventId     = idx["event id"] ?? idx["eventid"];

      // De-dupe FINAL rows by Idempotency (keep latest Timestamp)
      const byIdem = new Map(); // idem -> row
      for (let r = 1; r < subRows.length; r++) {
        const row = subRows[r] || [];
        const status = String(row[iAiStatus] || "").trim().toLowerCase();
        if (!status.includes("final")) continue;

        if (eventIdFilter && String(row[iEventId] || "").trim() !== eventIdFilter) continue;

        const idem = String(row[iIdempotency] || "").trim();
        const ts = new Date(row[iTimestamp] || 0).getTime() || 0;

        if (!idem) {
          // No idempotency? still keep (use unique key)
          const code = String(row[iTeamCode] || "").trim().toUpperCase();
          const act  = String(row[iActivity] || "").trim().toLowerCase();
          byIdem.set(`NOIDEM:${code}:${act}:${ts}`, row);
          continue;
        }
        const prev = byIdem.get(idem);
        if (!prev) byIdem.set(idem, row);
        else {
          const prevTs = new Date(prev[iTimestamp] || 0).getTime() || 0;
          if (ts >= prevTs) byIdem.set(idem, row);
        }
      }

      outByTeam = new Map();
      for (const row of byIdem.values()) {
        const teamCode = String(row[iTeamCode] || "").trim();
        if (!teamCode) continue;

        const act = activityKey(row[iActivity]);
        const score = num(row[iFinalScore]);

        if (!outByTeam.has(teamCode)) {
          outByTeam.set(teamCode, {
            teamCode,
            teamName: "", // filled from Teams sheet below
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
        agg.total += score; // always add to total
      }
    } else {
      // ---- FALLBACK: your existing Scores-based logic (unchanged) ----
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
        if (status && status !== "final") continue; // only final rows

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

    // ---- Merge team names from Teams tab (same as before) ----
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
