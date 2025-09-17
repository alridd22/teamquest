// netlify/functions/get_leaderboard.js
const { ok, error, isPreflight, getSheets, tabRange, SHEET_ID } = require("./_utils.js");

/**
 * Helper to read a sheet tab and map rows by header names.
 */
async function readSheetAsObjects(sheets, spreadsheetId, tabName) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: tabRange(tabName, "A1"),
  });
  const values = data.values || [];
  if (!values.length) return [];
  const headers = values[0].map(h => String(h || "").trim());
  const rows = values.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = r[i]));
    return obj;
  });
  return rows;
}

function norm(s) { return String(s || "").trim(); }
function toNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Parse an eventId out of a SubmissionID like "kindness|EVT-19-08-2025|TEAM-A".
 */
function extractEventIdFromSubmissionId(submissionId) {
  const parts = String(submissionId || "").split("|");
  // Expect [activity, eventId, teamCode]
  return parts.length >= 2 ? parts[1] : "";
}

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
      return error(405, "Use POST (or GET) for get_leaderboard");
    }

    // get eventId from body or query
    let eventId = "";
    if (event.httpMethod === "POST") {
      try {
        const body = JSON.parse(event.body || "{}");
        eventId = norm(body.eventId || body.event || "");
      } catch {
        /* ignore */
      }
    } else {
      const qs = new URLSearchParams(event.rawQuery || event.queryStringParameters || "");
      eventId = norm(qs.get?.("eventId") || qs.get?.("event") || "");
    }

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    // --- TEAMS (for names) ---
    // Expect a tab named "teams" with headers including "Team Code" and "Team Name".
    let teams = [];
    try {
      teams = await readSheetAsObjects(sheets, spreadsheetId, "teams");
    } catch { /* if there's no teams tab, we still proceed */ }

    const codeToName = new Map();
    for (const row of teams) {
      const code = norm(row["Team Code"]);
      const name = norm(row["Team Name"]);
      if (code) codeToName.set(code, name || code);
    }

    // --- SCORES (breakdown) ---
    // Your sheet shows: Team Code | Activity | Score | Status | SubmissionID
    const SCORES_TAB = "scores";
    let scoreRows = [];
    try {
      scoreRows = await readSheetAsObjects(sheets, spreadsheetId, SCORES_TAB);
    } catch (e) {
      console.error("Could not read scores tab:", e?.message || e);
      return ok({ success: true, columns: [], rows: [] }); // don’t crash the page
    }

    // Filter to finals and (if provided) this eventId
    const filtered = scoreRows.filter(r => {
      const status = norm(r["Status"]).toLowerCase();
      if (status !== "final") return false;

      if (!eventId) return true;

      const sid = norm(r["SubmissionID"]);
      const sidEvent = extractEventIdFromSubmissionId(sid);
      return sidEvent === eventId;
    });

    // Aggregate per team & per activity
    const activitySet = new Set();
    const byTeam = new Map(); // teamCode -> { parts: {activity:score}, total:number }

    for (const r of filtered) {
      const teamCode = norm(r["Team Code"]);
      if (!teamCode) continue;

      const activity = norm(r["Activity"]).toLowerCase();
      const score = toNum(r["Score"]);

      activitySet.add(activity);
      if (!byTeam.has(teamCode)) byTeam.set(teamCode, { parts: {}, total: 0 });
      const t = byTeam.get(teamCode);
      t.parts[activity] = (t.parts[activity] || 0) + score;
      t.total += score;
    }

    // Ensure all registered teams show up, even if they have no scores yet
    for (const [code] of codeToName) {
      if (!byTeam.has(code)) byTeam.set(code, { parts: {}, total: 0 });
    }

    // Build rows
    const activities = Array.from(activitySet).sort(); // e.g. ["kindness","limerick",...]
    const rows = [];
    for (const [teamCode, agg] of byTeam) {
      rows.push({
        teamCode,
        teamName: codeToName.get(teamCode) || teamCode,
        total: toNum(agg.total),
        parts: agg.parts, // object: { kindness: 20, limerick: 52, ... }
      });
    }

    // Sort by total desc, then by name
    rows.sort((a, b) => (b.total - a.total) || a.teamName.localeCompare(b.teamName));

    return ok({
      success: true,
      columns: activities,  // the HTML uses this to build the extra columns
      rows,                 // [{ teamCode, teamName, total, parts: {...} }]
    });

  } catch (e) {
    console.error("get_leaderboard error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
