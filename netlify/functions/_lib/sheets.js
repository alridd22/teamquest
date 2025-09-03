// /netlify/functions/_lib/sheets.js
// Google Sheets helper (direct Google API, no google-spreadsheet wrapper)
// Requires deps you already have: google-auth-library, googleapis

const { google } = require("googleapis");
const { JWT } = require("google-auth-library");
const fs = require("fs");
const path = require("path");

// --------- ENV / Config ----------
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_EMAIL_ENV = process.env.GOOGLE_SERVICE_EMAIL;

// Tab names in your doc
const EVENTS_SHEET_TITLE = "events";
const TEAMS_SHEET_TITLE  = "teams";
const SCORES_SHEET_TITLE = "submissions";

// Columns are dynamic; we read headers from row 1 for each sheet.
// We'll fetch A:Z by default; expand if you know you'll exceed Z.
const DEFAULT_RANGE = "A:Z";

// --------- SA credentials resolution ----------
function getServiceCreds() {
  // 1) Runtime env pair (if you ever add GOOGLE_SERVICE_ACCOUNT_KEY)
  const keyFromEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (keyFromEnv && SERVICE_EMAIL_ENV) {
    return { client_email: SERVICE_EMAIL_ENV, private_key: keyFromEnv.replace(/\\n/g, "\n") };
  }

  // 2) Build-written files (first valid wins)
  const p1 = path.join(__dirname, "_secrets", "sa.json");             // optional earlier path
  const p2 = path.join(__dirname, "..", "sa_key.json");               // your current build output
  const p3 = path.join(process.cwd(), "netlify", "functions", "sa_key.json"); // cwd fallback

  for (const p of [p1, p2, p3]) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, "utf8");
      const json = JSON.parse(raw);
      const client_email = json.client_email || SERVICE_EMAIL_ENV;
      const private_key  = String(json.private_key || "").replace(/\\n/g, "\n");
      if (client_email && private_key) return { client_email, private_key };
    } catch { /* try next */ }
  }

  throw new Error("Google Service Account credentials not available at runtime (checked env + sa.json/sa_key.json files).");
}

// --------- Low-level client ----------
async function getSheetsClient() {
  if (!SPREADSHEET_ID) throw new Error("Missing GOOGLE_SHEET_ID");
  const { client_email, private_key } = getServiceCreds();

  const jwt = new JWT({
    email: client_email,
    key: private_key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });

  const sheets = google.sheets({ version: "v4", auth: jwt });
  return sheets;
}

// Utility: read a whole sheet (A:Z), parse headers and rows
async function readSheet(title) {
  const sheets = await getSheetsClient();

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${title}!${DEFAULT_RANGE}`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  const values = data.values || [];
  if (values.length === 0) return { headers: [], rows: [], raw: [] };

  const headers = (values[0] || []).map(String);
  const rows = [];

  for (let i = 1; i < values.length; i++) {
    const arr = values[i] || [];
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = arr[idx] !== undefined ? arr[idx] : ""; });
    obj.__rowIndex = i + 1; // 1-based index in the sheet
    rows.push(obj);
  }

  return { headers, rows, raw: values };
}

// Utility: write a single row (by index) with updates merged into existing row
async function writeRow(title, rowIndex1, headers, updatedObj) {
  const sheets = await getSheetsClient();

  // Build the row array in header order
  const rowArr = headers.map(h => (updatedObj[h] !== undefined ? updatedObj[h] : ""));

  const range = `${title}!A${rowIndex1}:${colLetter(headers.length)}${rowIndex1}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: "RAW",
    requestBody: { values: [rowArr] },
  });
}

function colLetter(n) {
  // 1 -> A, 26 -> Z, 27 -> AA ...
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || "A";
}

// --------- High-level helpers (exported) ----------

async function getEventById(eventId) {
  const { headers, rows } = await readSheet(EVENTS_SHEET_TITLE);
  const row = rows.find(r => String(r["Event Id"]).trim() === String(eventId).trim()) || null;
  if (!row) return null;

  // Provide a light wrapper so callers can pass the same object to updateEventRow
  row.__sheetTitle = EVENTS_SHEET_TITLE;
  row.__headers = headers;
  return row;
}

async function updateEventRow(eventRow, updates = {}) {
  const headers = eventRow.__headers || Object.keys(eventRow).filter(k => !k.startsWith("__"));
  const rowIndex = eventRow.__rowIndex;
  if (!rowIndex) throw new Error("updateEventRow: missing __rowIndex");

  const merged = {};
  headers.forEach(h => { merged[h] = eventRow[h]; });
  Object.entries(updates).forEach(([k, v]) => { merged[k] = v; });
  merged["UpdatedAt (ISO)"] = new Date().toISOString();

  await writeRow(eventRow.__sheetTitle || EVENTS_SHEET_TITLE, rowIndex, headers, merged);
  return merged;
}

async function listTeamsByEventId(eventId) {
  const { rows } = await readSheet(TEAMS_SHEET_TITLE);
  return rows
    .filter(r => String(r["Event Id"]).trim() === String(eventId).trim())
    .map(r => ({ ...r, __sheetTitle: TEAMS_SHEET_TITLE }));
}

async function setTeamReturnedLocked(eventId, teamCode, returnedAtISO, locked = true) {
  const { headers, rows } = await readSheet(TEAMS_SHEET_TITLE);
  const row = rows.find(r =>
    String(r["Event Id"]).trim() === String(eventId).trim() &&
    String(r["Team Code"]).trim() === String(teamCode).trim()
  );
  if (!row) throw new Error("Team not found for this event");

  const updates = {
    "ReturnedAt (ISO)": returnedAtISO,
    "Locked": locked ? "TRUE" : "FALSE",
  };
  const merged = { ...row, ...updates };
  await writeRow(TEAMS_SHEET_TITLE, row.__rowIndex, headers, merged);
  return merged;
}

async function setTeamLock(eventId, teamCode, locked) {
  const { headers, rows } = await readSheet(TEAMS_SHEET_TITLE);
  const row = rows.find(r =>
    String(r["Event Id"]).trim() === String(eventId).trim() &&
    String(r["Team Code"]).trim() === String(teamCode).trim()
  );
  if (!row) throw new Error("Team not found for this event");

  const merged = { ...row, "Locked": locked ? "TRUE" : "FALSE" };
  await writeRow(TEAMS_SHEET_TITLE, row.__rowIndex, headers, merged);
  return merged;
}

async function readScoresForEvent(eventId) {
  const { headers, rows } = await readSheet(SCORES_SHEET_TITLE);

  // Prefer EventId column if present
  const hasEventIdCol = headers.some(h => h && h.toLowerCase().replace(/\s+/g, "") === "eventid");
  if (hasEventIdCol) {
    return rows.filter(r =>
      String(r["EventId"] || r["Event Id"] || "").trim() === String(eventId).trim()
    );
  }

  // Fallback: restrict to teams in this event
  const teamRows = await listTeamsByEventId(eventId);
  const teamSet = new Set(teamRows.map(t => String(t["Team Code"]).trim()));
  return rows.filter(r => teamSet.has(String(r["Team Code"] || "").trim()));
}

module.exports = {
  getEventById,
  updateEventRow,
  listTeamsByEventId,
  setTeamReturnedLocked,
  setTeamLock,
  readScoresForEvent,
};
