// netlify/functions/get_scavenger_submissions_function.js

const {
  ok,
  error,
  isPreflight,
  getSheets,
  SHEET_ID,
  indexByHeader,
} = require("./_utils.js");

module.exports.handler = async (event) => {
  try {
    // CORS preflight
    if (isPreflight(event)) return ok({});

    if (event.httpMethod !== "POST") {
      return error(405, "POST only");
    }

    // Parse body
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return error(400, "Invalid JSON");
    }

    const rawTeamCode = (body.teamCode || "").toString().trim();
    const rawEventId  = (body.eventId || "").toString().trim(); // optional

    if (!rawTeamCode) {
      return error(400, "teamCode is required");
    }

    const teamCode = rawTeamCode;
    const eventId  = rawEventId;

    const sheets = await getSheets();
    const spreadsheetId = SHEET_ID;

    // Read the unified submissions sheet that submit_scavenger_function writes to
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "submissions!A1:M",
    });

    const values = resp.data.values || [];
    if (!values.length) {
      return ok({
        success: true,
        teamCode,
        eventId,
        submissions: [],
        itemIds: [],
        timestamp: Date.now(),
      });
    }

    const { idx, rows } = indexByHeader(values);

    const iTeam    = idx["Team Code"];
    const iAct     = idx["Activity"];
    const iPayload = idx["Payload"];
    const iEvent   = idx["Event Id"]; // may be undefined if column missing

    if (
      typeof iTeam    !== "number" ||
      typeof iAct     !== "number" ||
      typeof iPayload !== "number"
    ) {
      return error(500, "submissions sheet missing required headers");
    }

    const wantedTeam  = teamCode;
    const wantedEvent = eventId;

    const itemIdSet = new Set();
    const submissions = [];

    for (const row of rows) {
      const rowTeam = (row[iTeam] || "").toString().trim();
      if (!rowTeam || rowTeam !== wantedTeam) continue;

      const act = (row[iAct] || "").toString().trim().toLowerCase();
      if (act !== "scavenger") continue;

      if (wantedEvent && typeof iEvent === "number") {
        const rowEvent = (row[iEvent] || "").toString().trim();
        // If Event Id column exists and is non-empty, enforce match
        if (rowEvent && rowEvent !== wantedEvent) continue;
      }

      const payloadStr = row[iPayload] || "";
      let payload = null;
      try {
        if (payloadStr) payload = JSON.parse(payloadStr);
      } catch {
        // ignore bad JSON, move on
      }

      let itemId = "";
      let items  = null;

      if (payload && typeof payload === "object") {
        if (payload.itemId) itemId = String(payload.itemId);
        if (Array.isArray(payload.items)) items = payload.items.map(String);
      }

      if (itemId) {
        itemIdSet.add(itemId);
        submissions.push({ itemId });
      } else if (items && items.length) {
        // Fallback: return items[] so frontend can map titles -> ids
        submissions.push({ items });
      }
    }

    return ok({
      success: true,
      teamCode,
      eventId,
      submissions,
      itemIds: Array.from(itemIdSet),
      timestamp: Date.now(),
    });
  } catch (e) {
    console.error("get_scavenger_submissions_function error:", e);
    return error(500, e.message || "Unexpected error", { timestamp: Date.now() });
  }
};
