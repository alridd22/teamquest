// get_event_state.js
const { ok, bad } = require("./_lib/http");
const { getEventById } = require("./_lib/sheets");

exports.handler = async (event) => {
  try {
    const url = new URL(event.rawUrl || `https://${event.headers.host}${event.path}`);
    const eventId = url.searchParams.get("eventId") || "EVT-19-08-2025";

    const row = await getEventById(eventId);
    if (!row) return bad(404, "Event not found");

    return ok({
      eventId,
      state: row["State"] || "DRAFT",
      startedAt: row["StartedAt (ISO)"] || null,
      endsAt: row["EndsAt (ISO)"] || null,
      penaltyPerMin: Number(row["PenaltyPerMin"] || 0)
    });
  } catch (e) {
    return bad(e.status || 500, e.message || "Error");
  }
};
