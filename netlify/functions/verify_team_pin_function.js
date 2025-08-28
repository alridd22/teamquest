// verify_team_pin_function.js — CommonJS, uses shared utils

const jwt = require("jsonwebtoken");
const {
  ok, error, isPreflight,
  getDoc, JWT_SECRET, CURRENT_EVENT,
} = require("./_utils.js");

const nowIso = () => new Date().toISOString();

module.exports.handler = async (event) => {
  try {
    // CORS preflight
    if (isPreflight(event)) return ok({});

    if (event.httpMethod !== "POST") return error(405, "POST only");

    // Parse body
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch { return error(400, "Invalid JSON"); }
    const teamCode = (body.teamCode || "").trim();
    const pin      = (body.pin || "").trim();
    if (!teamCode || !pin) return error(400, "teamCode and pin required");

    // Sheets doc (robust creds via _utils)
    const doc = await getDoc?.();
    if (!doc) return error(500, "Spreadsheet client not available");

    // Find or create "teams" sheet
    let teams = doc.sheetsByTitle ? doc.sheetsByTitle["teams"] : null;
    if (!teams) {
      teams = await doc.addSheet({
        title: "teams",
        headerValues: ["Team Code","Team Name","PIN","State","Device","LastSeen","Event Id"],
      });
    } else {
      await teams.loadHeaderRow();
      if (!teams.headerValues || teams.headerValues.length === 0) {
        await teams.setHeaderRow(["Team Code","Team Name","PIN","State","Device","LastSeen","Event Id"]);
        await teams.loadHeaderRow();
      }
    }

    // Locate team (case-insensitive), scoped to CURRENT_EVENT
    const rows = await teams.getRows();
    const ev = String(CURRENT_EVENT || "").trim(); // allow "default"
    const row = rows.find((r) => {
      const code = String(r.get("Team Code") || "").trim();
      const eventId = String(r.get("Event Id") || "").trim();
      const codeMatch = code.toUpperCase() === teamCode.toUpperCase();
      const eventMatch = eventId === ev || (!eventId && ev === "default");
      return codeMatch && eventMatch;
    });
    if (!row) return error(400, "Unknown team for this event");

    // Verify PIN
    const storedPin = String(row.get("PIN") || "").trim();
    if (storedPin !== pin) return error(401, "Invalid PIN");

    // Update state/last-seen/event
    if (!row.get("State")) row.set("State", "READY");
    row.set("LastSeen", nowIso());
    row.set("Event Id", ev || row.get("Event Id") || "");
    await row.save();

    // Sign token (8h)
    const token = jwt.sign(
      { teamCode: row.get("Team Code"), event: ev },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    return ok({
      success: true,
      token,
      teamCode: row.get("Team Code"),
      state: row.get("State") || "READY",
      event: ev,
    });
  } catch (e) {
    console.error("verify_team_pin_function error:", e);
    return error(500, e.message || "Auth error");
  }
};
