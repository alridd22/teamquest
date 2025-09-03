// _lib/sheets.js
const { GoogleSpreadsheet } = require("google-spreadsheet");
const fs = require("fs");
const path = require("path");

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SVC_EMAIL_ENV = process.env.GOOGLE_SERVICE_EMAIL;

// Where your postinstall drops the SA JSON during build (bundle it with functions)
const SA_PATH = path.join(__dirname, "_secrets", "sa.json");

function getServiceCreds() {
  // 1) Direct key in env (rare in your setup, but supported)
  const keyFromEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (keyFromEnv && SVC_EMAIL_ENV) {
    return { client_email: SVC_EMAIL_ENV, private_key: keyFromEnv.replace(/\\n/g, "\n") };
  }

  // 2) From bundled file created at build by scripts/write-sa-key.cjs
  if (fs.existsSync(SA_PATH)) {
    try {
      const json = JSON.parse(fs.readFileSync(SA_PATH, "utf8"));
      const client_email = json.client_email || SVC_EMAIL_ENV;
      const private_key = (json.private_key || "").replace(/\\n/g, "\n");
      if (client_email && private_key) return { client_email, private_key };
    } catch { /* fall through */ }
  }

  // If we get here, creds aren’t available to runtime
  throw new Error("Google Service Account credentials not available at runtime. Ensure build writes _secrets/sa.json.");
}

async function loadDoc() {
  if (!SHEET_ID) throw new Error("Missing GOOGLE_SHEET_ID");
  const creds = getServiceCreds();

  const doc = new GoogleSpreadsheet(SHEET_ID);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
  return doc;
}

async function getSheets() {
  const doc = await loadDoc();
  const events = doc.sheetsByTitle["events"];
  const teams  = doc.sheetsByTitle["teams"];
  const scores = doc.sheetsByTitle["submissions"];
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
