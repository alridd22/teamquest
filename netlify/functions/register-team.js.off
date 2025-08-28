// register-team.js — CommonJS, uses shared utils

const {
  ok, error, isPreflight,
  getDoc, getOrCreateSheet, CURRENT_EVENT,
} = require("./_utils.js");

// If your utils don't have nowIso, we'll inline a tiny helper:
const nowIso = () => new Date().toISOString();

module.exports.handler = async (event) => {
  try {
    // CORS preflight
    if (isPreflight(event)) return ok({});

    if (event.httpMethod !== "POST") return error(405, "POST only");

    // Parse body
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return error(400, "Invalid JSON");
    }

    const teamCode = (body.teamCode || "").trim();
    const teamName = (body.teamName || "").trim();
    const pin      = body.pin ? String(body.pin).trim() : "";
    const device   = body.device ? String(body.device).trim() : "";

    if (!teamCode) return error(400, "teamCode is required");
    if (!teamName) return error(400, "teamName is required");

    // Spreadsheet client via shared utils (uses robust key loading)
    const doc = await getDoc?.();
    if (!doc) return error(500, "Spreadsheet client not available");

    // Ensure 'teams' sheet with expected headers
    const teams = await getOrCreateSheet(doc, "teams", [
      "Team Code", "Team Name", "PIN", "State", "Device", "LastSeen", "Event Id"
    ]);

    // Load rows and find existing team for current event
    const rows = await teams.getRows();
    const row = rows.find(r =>
      String(r.get("Team Code")).trim() === teamCode &&
      String(r.get("Event Id") || "").trim() === String(CURRENT_EVENT)
    );

    // Idempotent create/update
    if (!row) {
      await teams.addRow({
        "Team Code": teamCode,
        "Team Name": teamName,
        "PIN": pin,
        "State": "REGISTERED",
        "Device": device,
        "LastSeen": nowIso(),
        "Event Id": String(CURRENT_EVENT),
      });
      return ok({ success: true, created: true, teamCode, teamName, event: CURRENT_EVENT });
    } else {
      // update only when needed; keep existing values if not provided
      if (teamName && row.get("Team Name") !== teamName) row.set("Team Name", teamName);
      if (pin && row.get("PIN") !== pin) row.set("PIN", pin);
      if (device) row.set("Device", device);
      if (!row.get("State")) row.set("State", "REGISTERED");
      row.set("LastSeen", nowIso());
      await row.save();

      return ok({
        success: true,
        updated: true,
        teamCode,
        teamName: row.get("Team Name"),
        event: CURRENT_EVENT
      });
    }
  } catch (e) {
    console.error("register-team error:", e);
    return error(500, e.message || "Unexpected error");
  }
};
