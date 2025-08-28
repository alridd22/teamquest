// watchdog_function.js — CommonJS, uses shared utils

const { ok, error, isPreflight, getDoc } = require("./_utils.js");

module.exports.handler = async (event) => {
  try {
    // CORS preflight
    if (isPreflight(event)) return ok({});

    const doc = await getDoc?.();
    if (!doc) return error(500, "Spreadsheet client not available");

    // Ensure a sheet exists with given title & headers.
    // If the sheet exists but has no headers, set them.
    async function ensureSheet(title, headerValues) {
      let sheet = doc.sheetsByTitle ? doc.sheetsByTitle[title] : null;
      if (!sheet) {
        sheet = await doc.addSheet({ title, headerValues });
        return sheet;
      }
      await sheet.loadHeaderRow().catch(() => {});
      if (!sheet.headerValues || sheet.headerValues.length === 0) {
        await sheet.setHeaderRow(headerValues);
        await sheet.loadHeaderRow().catch(() => {});
      }
      return sheet;
    }

    // Create/check all the expected sheets
    await ensureSheet("teams", [
      "Team Code", "Team Name", "PIN", "State", "Device", "LastSeen", "Event Id"
    ]);

    await ensureSheet("team_states", [
      "Team Code", "Activity", "State", "lockedAt", "Nonce", "lastResponse", "Event Id"
    ]);

    await ensureSheet("submissions", [
      "Timestamp", "Team Code", "Activity", "Nonce", "Payload",
      "AI Status", "AI Attempts", "AI Score", "Final Score", "Idempotency", "Event Id"
    ]);

    await ensureSheet("competition", [
      "Event Id", "Key", "Value"
    ]);

    await ensureSheet("checkins", [
      "Team Code", "CheckedInAt", "Status", "Penalty", "Event Id"
    ]);

    return ok({ success: true, message: "Sheets checked/created" });
  } catch (e) {
    console.error("watchdog error:", e);
    return error(500, e.message || "Watchdog error");
  }
};
