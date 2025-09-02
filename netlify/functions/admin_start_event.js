// admin_start_event.js
const { ok, bad, requireAdmin, getBody } = require("./_lib/http");
const { getEventById, updateEventRow } = require("./_lib/sheets");

exports.handler = async (event) => {
  try {
    requireAdmin(event);
    const { eventId, durationSec, penaltyPerMin } = getBody(event);
    if (!eventId) return bad(400, "eventId required");

    const row = await getEventById(eventId);
    if (!row) return bad(404, "Event not found");

    const now = new Date();
    const dur = Number(durationSec || row["DurationSec"] || 0);
    if (!dur) return bad(400, "durationSec required");

    const ends = new Date(now.getTime() + dur * 1000);

    await updateEventRow(row, {
      "State": "RUNNING",
      "StartedAt (ISO)": now.toISOString(),
      "EndsAt (ISO)": ends.toISOString(),
      "PenaltyPerMin": Number(penaltyPerMin ?? row["PenaltyPerMin"] ?? 0)
    });

    return ok({ eventId, startedAt: row["StartedAt (ISO)"], endsAt: row["EndsAt (ISO)"] });
  } catch (e) {
    return bad(e.status || 500, e.message || "Error");
  }
};
