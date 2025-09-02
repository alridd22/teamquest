// admin_publish_final.js
const { ok, bad, requireAdmin, getBody } = require("./_lib/http");
const { getEventById, updateEventRow } = require("./_lib/sheets");

exports.handler = async (event) => {
  try {
    requireAdmin(event);
    const { eventId } = getBody(event);
    if (!eventId) return bad(400, "eventId required");

    const row = await getEventById(eventId);
    if (!row) return bad(404, "Event not found");

    await updateEventRow(row, {
      "State": "PUBLISHED",
      "PublishedAt (ISO)": new Date().toISOString()
    });

    return ok({ eventId, publishedAt: row["PublishedAt (ISO)"] });
  } catch (e) {
    return bad(e.status || 500, e.message || "Error");
  }
};
