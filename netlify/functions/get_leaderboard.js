// /netlify/functions/get_leaderboard.js
const { ok, bad } = require("./_lib/http");
const { getEventById, listTeamsByEventId, readScoresForEvent } = require("./_lib/sheets");

const DEFAULT_EVENT_ID = process.env.TQ_CURRENT_EVENT_ID || "EVT-19-08-2025";

exports.handler = async (event) => {
  try {
    const url = new URL(event.rawUrl || `https://${event.headers.host}${event.path}`);
    const eventId = url.searchParams.get("eventId") || DEFAULT_EVENT_ID;

    const [eventRow, teamRows, scoreRows] = await Promise.all([
      getEventById(eventId),
      listTeamsByEventId(eventId),
      readScoresForEvent(eventId)
    ]);
    if (!eventRow) return bad(404, "Event not found");

    const state = eventRow["State"] || "DRAFT";
    const endsAtISO = eventRow["EndsAt (ISO)"] || null;
    const penaltyPerMin = Number(eventRow["PenaltyPerMin"] || 0);

    // Base totals from submissions (Points column)
    const totals = Object.create(null);
    const teamSet = new Set(teamRows.map(r => String(r["Team Code"]).trim()));

    for (const r of scoreRows) {
      const teamCode = String(r["Team Code"] || "").trim();
      if (!teamCode || !teamSet.has(teamCode)) continue;

      // Accept "Points" or "points"
      const pts = Number(r["Points"] ?? r["points"] ?? 0);
      if (!Number.isFinite(pts)) continue;

      totals[teamCode] = (totals[teamCode] || 0) + pts;
    }

    // Build team meta
    const metaByCode = Object.create(null);
    teamRows.forEach(r => {
      const code = String(r["Team Code"]).trim();
      metaByCode[code] = {
        teamCode: code,
        teamName: r["Team Name"],
        locked: String(r["Locked"] || "").toUpperCase() === "TRUE",
        returnedAt: r["ReturnedAt (ISO)"] || null
      };
    });

    // Apply late penalties (computed, never written)
    const now = new Date();
    const ends = endsAtISO ? new Date(endsAtISO) : null;

    const rows = Object.values(metaByCode).map(t => {
      const base = totals[t.teamCode] || 0;
      let penaltyApplied = 0;

      const isLate = ends && now > ends && !t.returnedAt;
      if (isLate && penaltyPerMin > 0) {
        const minsLate = Math.ceil((now.getTime() - ends.getTime()) / 60000);
        penaltyApplied = minsLate * penaltyPerMin;
      }

      const score = Math.max(0, base - penaltyApplied);
      return { ...t, score, penaltyApplied };
    });

    rows.sort((a, b) => (b.score - a.score) || a.teamName.localeCompare(b.teamName));

    return ok({
      eventId,
      state,
      rows,
      lastUpdated: new Date().toISOString()
    });
  } catch (e) {
    return bad(e.status || 500, e.message || "Error");
  }
};

