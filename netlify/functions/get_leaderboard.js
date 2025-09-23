// netlify/functions/get_leaderboard.js
const { ok, error, isPreflight, getDoc } = require("./_utils.js");

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});

    const eventId =
      event.queryStringParameters?.eventId ||
      process.env.DEFAULT_EVENT_ID ||
      "";

    const doc = await getDoc();
    if (!doc) return error(500, "Spreadsheet client not available");

    const teamsSheet =
      doc.sheetsByTitle["Teams"] ||
      doc.sheetsByTitle["teams"] ||
      doc.sheetsByTitle["Crews"];
    const submissionsSheet =
      doc.sheetsByTitle["submissions"] ||
      doc.sheetsByTitle["Submissions"];

    if (!teamsSheet || !submissionsSheet) {
      return error(500, "Required sheets not found");
    }

    await Promise.all([teamsSheet.loadHeaderRow(), submissionsSheet.loadHeaderRow()]);
    const [teamRows, subRows] = await Promise.all([
      teamsSheet.getRows(),
      submissionsSheet.getRows(),
    ]);

    // Build team map
    const teams = new Map();
    for (const r of teamRows) {
      const code =
        r.get("Team Code") || r.get("teamCode") || r.get("Code") || "";
      const name =
        r.get("Team Name") || r.get("teamName") || r.get("Name") || "";
      if (!code) continue;
      teams.set(code, {
        teamCode: code,
        teamName: name,
        kindness: 0,
        limerick: 0,
        scavenger: 0,
        quiz: 0,
        total: 0,
      });
    }

    const ACTIVITY_KEYS = new Set(["kindness", "limerick", "scavenger", "quiz"]);

    // Aggregate from submissions
    for (const r of subRows) {
      const activity = String(r.get("Activity") || "").toLowerCase().trim();
      if (!ACTIVITY_KEYS.has(activity)) continue;

      const code = r.get("Team Code") || r.get("teamCode") || "";
      if (!teams.has(code)) continue;

      const rowEventId = (r.get("Event Id") || r.get("eventId") || "").trim();
      if (eventId && rowEventId && rowEventId !== eventId) continue;

      // For AI-scored items, only count FINAL. Quiz is immediate, so allow it regardless.
      const status = String(r.get("AI Status") || "FINAL").toUpperCase();
      if (activity !== "quiz" && status !== "FINAL") continue;

      const scoreNum = Number(r.get("Final Score") || r.get("AI Score") || 0) || 0;
      if (!scoreNum) continue;

      const t = teams.get(code);
      t[activity] = (t[activity] || 0) + scoreNum;
    }

    // Totals & output
    const out = Array.from(teams.values()).map((t) => ({
      ...t,
      total: (t.kindness || 0) + (t.limerick || 0) + (t.scavenger || 0) + (t.quiz || 0),
    }));

    // sort by total desc, then name
    out.sort((a, b) => (b.total - a.total) || a.teamName.localeCompare(b.teamName));

    return ok({ success: true, eventId, teams: out });
  } catch (e) {
    console.error("get_leaderboard error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
