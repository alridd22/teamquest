// _lib/sheets.js
const { GoogleSpreadsheet } = require("google-spreadsheet");

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SVC_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SVC_KEY   = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "").replace(/\\n/g, "\n");

const EVENTS_SHEET_TITLE = "events";
const TEAMS_SHEET_TITLE  = "teams";
const SCORES_SHEET_TITLE = "submissions"; // your canonical Scores tab

async function loadDoc() {
  if (!SHEET_ID || !SVC_EMAIL || !SVC_KEY) {
    throw new Error("Missing Google Sheets env vars (GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY)");
  }
  const doc = new GoogleSpreadsheet(SHEET_ID);
  await doc.useServiceAccountAuth({ client_email: SVC_EMAIL, private_key: SVC_KEY });
  await doc.loadInfo();
  return doc;
}

async function getSheets() {
  const doc = await loadDoc();
  const events = doc.sheetsByTitle[EVENTS_SHEET_TITLE];
  const teams  = doc.sheetsByTitle[TEAMS_SHEET_TITLE];
  const scores = doc.sheetsByTitle[SCORES_SHEET_TITLE];
  if (!events || !teams || !scores) {
    throw new Error("Missing one or more required tabs: events / teams / submissions");
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
  const { scores } = await getSheets();
  const rows = await scores.getRows();
  // Prefer EventId column if present. If not, we’ll include all rows and rely on team filtering.
  const hasEventIdCol = scores.headerValues.some(h => h.toLowerCase().replace(/\s+/g,'') === "eventid");
  return hasEventIdCol
    ? rows.filter(r => String(r["EventId"] || r["Event Id"] || "").trim() === String(eventId).trim())
    : rows;
}

module.exports = {
  getEventById,
  updateEventRow,
  listTeamsByEventId,
  setTeamReturnedLocked,
  setTeamLock,
  readScoresForEvent,
};
