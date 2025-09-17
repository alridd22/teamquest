// netlify/functions/get_leaderboard.js
const { ok, error, isPreflight, getSheets, tabRange, SHEET_ID } = require("./_utils.js");

// ---------- small helpers ----------
const norm = (s) => String(s ?? "").trim();
const toNum = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

function ciFind(headers, name) {
  const target = name.toLowerCase();
  const idx = headers.findIndex(h => String(h).toLowerCase() === target);
  return idx >= 0 ? idx : -1;
}

function firstRowAsHeaders(values) {
  const rows = values || [];
  if (!rows.length) return [];
  return rows[0].map(h => norm(h));
}

async function getTabHeaders(sheets, spreadsheetId, title) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${title}!A1:Z1`,
  });
  return firstRowAsHeaders(data.values);
}

async function readTabAsObjects(sheets, spreadsheetId, title) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: tabRange(title, "A1"),
  });
  const values = data.values || [];
  if (!values.length) return [];
  const headers = values[0].map(h => norm(h));
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = row[i]));
    return obj;
  });
}

function extractEventIdFromSubmissionId(submissionId) {
  // Accept: "kindness|EVT-19-08-2025|TEAM-A" OR "limerick|EVT-19-08-2025"
  const parts = String(submissionId || "").split("|");
  return parts.length >= 2 ? parts[1] : "";
}

// ---------- main ----------
module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});
    if (!["GET", "POST"].includes(event.httpMethod)) {
      return error(405, "Use GET or POST");
    }

    // read eventId from body or query
    let eventId = "";
    if (event.httpMethod === "POST") {
      try {
        const body = JSON.parse(event.body || "{}");
        eventId = norm(body.eventId || body.event || "");
      } catch {}
    } else {
      const qp = event.queryStringParameters || {};
      eventId = norm(qp.eventId || qp.event || "");
    }

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    // list sheet titles
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const allTabs = (meta.data.sheets || []).map(s => s.properties?.title).filter(Boolean);

    // ---- find SCORES-like tab
    let scoresTab = null;
    for (const t of allTabs) {
      try {
        const headers = await getTabHeaders(sheets, spreadsheetId, t);
        const lc = headers.map(h => h.toLowerCase());
        const hasTeam   = lc.includes("team code");
        const hasAct    = lc.includes("activity");
        const hasScore  = lc.includes("score");
        const hasStatus = lc.includes("status");
        if (hasTeam && hasAct && hasScore && hasStatus) {
          scoresTab = t;
          break;
        }
      } catch { /* ignore and continue */ }
    }
    if (!scoresTab) {
      console.warn("No scores-like tab found (needs Team Code, Activity, Score, Status).");
      return ok({ success: true, columns: [], rows: [] });
    }

    // ---- read SCORES rows
    const scoreRows = await readTabAsObjects(sheets, spreadsheetId, scoresTab);

    // ---- (optional) pick up team names from a teams-like tab
    let codeToName = new Map();
    for (const t of allTabs) {
      try {
        const headers = await getTabHeaders(sheets, spreadsheetId, t);
        const lc = headers.map(h => h.toLowerCase());
        const iCode = lc.indexOf("team code");
        const iName = lc.indexOf("team name");
        if (iCode >= 0 && iName >= 0) {
          const rows = await readTabAsObjects(sheets, spreadsheetId, t);
          const map = new Map();
          for (const r of rows) {
            const code = norm(r[headers[iCode]]);
            const name = norm(r[headers[iName]]);
            if (code) map.set(code, name || code);
          }
          if (map.size) { codeToName = map; }
          break;
        }
      } catch { /* ignore */ }
    }

    // ---- normalise rows
    const normRows = scoreRows.map(r => ({
      teamCode: norm(r["Team Code"]),
      activity: norm(r["Activity"]).toLowerCase(),
      score: toNum(r["Score"]),
      status: norm(r["Status"]).toLowerCase(),
      submissionId: norm(r["SubmissionID"]),
    }));

    // ---- filter: finals only
    let finals = normRows.filter(r => r.status === "final");

    // ---- filter: eventId (if provided)
    let filtered = finals;
    if (eventId) {
      filtered = finals.filter(r => extractEventIdFromSubmissionId(r.submissionId) === eventId);
      // if strict filter produced nothing, fall back to "all finals"
      if (!filtered.length) filtered = finals;
    }

    // ---- aggregate per team / per activity
    const activitySet = new Set();
    const byTeam = new Map(); // code -> { total, parts: {activity:score} }

    for (const r of filtered) {
      if (!r.teamCode) continue;
      activitySet.add(r.activity);
      if (!byTeam.has(r.teamCode)) byTeam.set(r.teamCode, { total: 0, parts: {} });
      const agg = byTeam.get(r.teamCode);
      agg.parts[r.activity] = (agg.parts[r.activity] || 0) + r.score;
      agg.total += r.score;
    }

    // If you want all registered teams to appear (even with 0) and we found a teams tab:
    for (const code of codeToName.keys()) {
      if (!byTeam.has(code)) byTeam.set(code, { total: 0, parts: {} });
    }

    // build rows for UI
    const activities = Array.from(activitySet).sort(); // e.g. ["kindness","limerick"]
    const rows = [];
    for (const [teamCode, agg] of byTeam) {
      rows.push({
        teamCode,
        teamName: codeToName.get(teamCode) || teamCode,
        total: toNum(agg.total),
        parts: agg.parts,     // {kindness: 20, limerick: 52, ...}
      });
    }
    rows.sort((a, b) => (b.total - a.total) || a.teamName.localeCompare(b.teamName));

    return ok({ success: true, columns: activities, rows });
  } catch (e) {
    console.error("get_leaderboard error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
