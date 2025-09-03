// /netlify/functions/team_register.js
const { ok, bad, getBody } = require("./_lib/http");
const { listTeamsByEventId } = require("./_lib/sheets");
const { signTeamToken } = require("./_lib/auth");
const { google } = require("googleapis");
const { JWT } = require("google-auth-library");
const fs = require("fs");
const path = require("path");

// Default event
const DEFAULT_EVENT_ID = process.env.TQ_CURRENT_EVENT_ID || "EVT-19-08-2025";
// Sheet info/env (same as _lib/sheets.js)
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_EMAIL_ENV = process.env.GOOGLE_SERVICE_EMAIL;

function getServiceCreds() {
  const keyFromEnv = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (keyFromEnv && SERVICE_EMAIL_ENV) {
    return { client_email: SERVICE_EMAIL_ENV, private_key: keyFromEnv.replace(/\\n/g, "\n") };
  }
  const p1 = path.join(__dirname, "_lib", "_secrets", "sa.json");
  const p2 = path.join(__dirname, "sa_key.json");
  const p3 = path.join(process.cwd(), "netlify", "functions", "sa_key.json");
  for (const p of [p1, p2, p3]) {
    if (!fs.existsSync(p)) continue;
    try {
      const json = JSON.parse(fs.readFileSync(p, "utf8"));
      const client_email = json.client_email || SERVICE_EMAIL_ENV;
      const private_key = String(json.private_key || "").replace(/\\n/g, "\n");
      if (client_email && private_key) return { client_email, private_key };
    } catch {}
  }
  throw new Error("Service Account creds not available at runtime for team_register");
}

async function sheetsClient() {
  const { client_email, private_key } = getServiceCreds();
  const jwt = new JWT({
    email: client_email,
    key: private_key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });
  return google.sheets({ version: "v4", auth: jwt });
}

function colLetter(n){ let s=""; while(n>0){const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26);} return s; }

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return bad(405, "POST only");
    const { teamCode, pin, teamName, device } = getBody(event);
    const eventId = getBody(event).eventId || DEFAULT_EVENT_ID;

    if (!teamCode || !pin) return bad(400, "teamCode and pin required");

    // Find the team row
    const teams = await listTeamsByEventId(eventId);
    const row = teams.find(r => String(r["Team Code"]).trim() === String(teamCode).trim());
    if (!row) return bad(404, "Team not found for this event");

    const expectedPin = String(row["PIN"] || "").trim();
    if (!expectedPin || expectedPin !== String(pin).trim()) return bad(401, "Invalid PIN");

    if (String(row["Locked"]||"").toUpperCase()==="TRUE") {
      return bad(403, "Team is locked (already checked in)");
    }

    // Prepare updates
    const nowIso = new Date().toISOString();
    const newName = (teamName || "").trim();
    const dev = (device || event.headers["user-agent"] || "").slice(0,180);

    // We need to write back to the teams sheet: Team Name (optional), Device, LastSeen
    const sheets = await sheetsClient();
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "teams!A:Z",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const values = data.values || [];
    const headers = (values[0] || []).map(String);
    const rowIndex = row.__rowIndex || (1 + values.findIndex((r, i) => {
      if (i === 0) return false;
      const obj = {};
      headers.forEach((h, idx) => obj[h] = r[idx]);
      return String(obj["Event Id"]).trim() === String(eventId).trim()
          && String(obj["Team Code"]).trim() === String(teamCode).trim();
    }));
    if (rowIndex <= 1) return bad(500, "Unable to locate team row index for update");

    // Build merged row data
    const currentRowArr = values[rowIndex - 1] || [];
    const current = {};
    headers.forEach((h, idx) => current[h] = currentRowArr[idx] !== undefined ? currentRowArr[idx] : "");

    if (newName) current["Team Name"] = newName;
    if (dev) current["Device"] = dev;
    current["LastSeen"] = nowIso;

    const outArr = headers.map(h => (current[h] !== undefined ? current[h] : ""));
    const range = `teams!A${rowIndex}:${colLetter(headers.length)}${rowIndex}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [outArr] },
    });

    const token = signTeamToken({
      teamCode,
      teamName: current["Team Name"] || row["Team Name"] || teamCode,
      eventId,
      device: dev
    });

    return ok({
      eventId,
      teamCode,
      teamName: current["Team Name"] || row["Team Name"] || teamCode,
      token
    });
  } catch (e) {
    return bad(e.status || 500, e.message || "Error");
  }
};
