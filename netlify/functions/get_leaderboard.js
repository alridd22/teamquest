// get_leaderboard.js
const { ok, bad } = require("./_lib/http");
const { getEventById, listTeamsByEventId, readScoresForEvent } = require("./_lib/sheets");

exports.handler = async (event) => {
  try {
    const url = new URL(event.rawUrl || `https://${event.headers.host}${event.path}`);
    const eventId = url.searchParams.get("eventId") || "EVT-19-08-2025";

    const [eventRow, teamRows, scoreRows] = await Promise.all([
      getEventById(eventId),
      listTeamsByEventId(eventId),
      readScoresForEvent(eventId)
    ]);
    if (!eventRow) return bad(404, "Event not found");

    const state = eventRow["State"] || "DRAFT";
    const endsAtISO = eventRow["EndsAt (ISO)"] || null;
    const penaltyPerMin = Number(eventRow["PenaltyPerMin"] || 0);

    // Build a map of team totals from submissions
    const totals = Object.create(null);
    for (const r of scoreRows) {
      // If readScoresForEvent couldn't filter by EventId, filter by team membership:
      const teamCode = String(r["Team Code"] || "").trim();
      if (!teamCode) continue;
      const belongsToEvent = teamRows.some(t => String(t["Team Code"]).trim() === teamCode);
      if (!belongsToEvent) continue;

      const pts = Number(r["Points"] || r["points"] || 0);
      if (!Number.isFinite(pts)) continue;
      totals[teamCode] = (totals[teamCode] || 0) + pts;
    }

    // Map team meta
    const teamsByCode = Object.create(null);
    teamRows.forEach(r => {
      const code = String(r["Team Code"]).trim();
      teamsByCode[code] = {
        teamCode: code,
        teamName: r["Team Name"],
        locked: String(r["Locked"]||"").toUpperCase()==="TRUE",
        returnedAt: r["ReturnedAt (ISO)"] || null
      };
    });

    // Compute penalties
    const now = new Date();
    const ends = endsAtISO ? new Date(endsAtISO) : null;

    const rows = Object.values(teamsByCode).map(t => {
      const base = totals[t.teamCode] || 0;
      let penaltyApplied = 0;

      const isLate = (ends && now > ends && !t.returnedAt);
      if (isLate && penaltyPerMin > 0) {
        const minsLate = Math.ceil((now.getTime() - ends.getTime()) / 60000);
        penaltyApplied = minsLate * penaltyPerMin;
      }

      const score = Math.max(0, base - penaltyApplied);
      return { ...t, score, penaltyApplied };
    });

    // Sort by score desc; stable-ish
    rows.sort((a, b) => (b.score - a.score) || a.teamName.localeCompare(b.teamName));

    return ok({ eventId, state, rows, lastUpdated: new Date().toISOString() });
  } catch (e) {
    return bad(e.status || 500, e.message || "Error");
  }
};
