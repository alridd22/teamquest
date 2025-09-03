// /netlify/functions/_lib/sheets.js
const { GoogleSpreadsheet } = require("google-spreadsheet");
const fs = require("fs");
const path = require("path");

// --- Configuration (matches your project) ---
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_EMAIL_ENV = process.env.GOOGLE_SERVICE_EMAIL;

// Tab names in your spreadsheet
const EVENTS_SHEET_TITLE = "events";
const TEAMS_SHEET_TITLE  = "teams";
const SCORES_SHEET_TITLE = "submissions";

// Resolve service account credentials from env OR build-written files
function getServiceCreds() {
  // 1) Runtime env pair (optional but supported)
  const keyFromEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (keyFromEnv && SERVICE_EMAIL_ENV) {
    return {
      client_email: SERVICE_EMAIL_ENV,
      private_key: keyFromEnv.replace(/\\n/g, "\n"),
    };
  }

  // 2) Build-written files (first existing/valid wins)
  //    a) earlier suggestion path
  const p1 = path.join(__dirname, "_secrets", "sa.json");
  //    b) your current build script output (../sa_key.json relative to _lib)
  const p2 = path.join(__dirname, "..", "sa_key.json");
  //    c) cwd fallback if bundling changes relative paths
  const p3 = path.join(process.cwd(), "netlify", "functions", "sa_key.json");

  const candidates = [p1, p2, p3];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, "utf8");
      const json = JSON.parse(raw);
      const client_email = json.client_email || SERVICE_EMAIL_ENV;
      const private_key  = String(json.private_key || "").replace(/\\n/g, "\n");
      if (client_email && private_key) {
        return { client_email, private_key };
      }
    } catch {
      // try next candidate
    }
  }

  throw new Error(
    "Google Service Account credentials not available at runtime. " +
    "Checked env GOOGLE_SERVICE_ACCOUNT_KEY and files: _lib/_secrets/sa.json, ../sa_key.json, netlify/functions/sa_key.json."
  );
}

async function loadDoc() {
  if (!SHEET_ID) {
    throw new Error("Missing GOOGLE_SHEET_ID");
  }
  const creds = getServiceCreds();

  const doc = new GoogleSpreadsheet(SHEET_ID);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
  return doc;
}

async function getSheets() {
  const doc = await loadDoc();
  const events = doc.sheetsByTitle[EVENTS_SHEET_TITLE];
  const teams  = doc.sheetsByTitle[TEAMS_SHEET_TITLE];
  const scores = doc.sheetsByTitle[SCORES_SHEET_TITLE];

  if (!events || !teams || !scores) {
    throw new Error(
      `Missing one or more required tabs: "${EVENTS_SHEET_TITLE}" / "${TEAMS_SHEET_TITLE}" / "${SCORES_SHEET_TITLE}"`
    );
  }
  return { events, teams, scores };
}

async function getEventById(eventId) {
  const { events } = await getSheets();
  const rows = await events.getRows();
  return rows.find(r => String(r["Event Id"]).trim() === String(eventId).trim()) || null;
}

async function updateEventRow(eventRow, updates = {}) {
  Object.entries(updates).forEach(([k, v]) => { eventRow[k] = v; });
  eventRow["UpdatedAt (ISO)"] = new Date().toISOString();
  await eventRow.save();
  return eventRow;
}

async function listTeamsByEventId(eventId) {
  const { teams } = await getSheets();
  const rows = await teams.getRows();
  return rows.filter(r => String(r["Event Id"]).trim() === String(eventId).trim());
}

async function setTeamReturnedLocked(eventId, teamCode, returnedAtISO, locked = true) {
  const { teams } = await getSheets();
  const rows = await teams.getRows();
  const row = rows.find(r =>
    String(r["Event Id"]).trim() === String(eventId).trim() &&
    String(r["Team Code"]).trim() === String(teamCode).trim()
  );
  if (!row) throw new Error("Team not found for this event");
  row["ReturnedAt (ISO)"] = returnedAtISO;
  row["Locked"] = locked ? "TRUE" : "FALSE";
  await row.save();
  return row;
}

async function setTeamLock(eventId, teamCode, locked) {
  const { teams } = await getSheets();
  const rows = await teams.getRows();
  const row = rows.find(r =>
    String(r["Event Id"]).trim() === String(eventId).trim() &&
    String(r["Team Code"]).trim() === String(teamCode).trim()
  );
  if (!row) throw new Error("Team not found for this event");
  row["Locked"] = locked ? "TRUE" : "FALSE";
  await row.save();
  return row;
}

async function readScoresForEvent(eventId) {
  const { scores, teams } = await getSheets();
  const scoreRows = await scores.getRows();

  // Filter by EventId column if present; otherwise filter by team membership.
  const hasEventIdCol = scores.headerValues.some(
    h => h && h.toLowerCase().replace(/\s+/g, "") === "eventid"
  );

  if (hasEventIdCol) {
    return scoreRows.filter(r =>
      String(r["EventId"] || r["Event Id"] || "").trim() === String(eventId).trim()
    );
  }

  // Fallback: include only rows whose Team Code exists in this event's teams
  const teamRows = await teams.getRows();
  const eventTeamCodes = new Set(
    teamRows
      .filter(r => String(r["Event Id"]).trim() === String(eventId).trim())
      .map(r => String(r["Team Code"]).trim())
  );
  return scoreRows.filter(r => eventTeamCodes.has(String(r["Team Code"] || "").trim()));
}

module.exports = {
  getEventById,
  updateEventRow,
  listTeamsByEventId,
  setTeamReturnedLocked,
  setTeamLock,
  readScoresForEvent,
};
