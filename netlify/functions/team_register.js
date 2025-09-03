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
    const body = getBody(event);

    const eventId  = body.eventId || DEFAULT_EVENT_ID;
    const teamCode = String(body.teamCode || "").trim().toUpperCase();
    const pin      = String(body.pin || "").trim();
    const teamName = String(body.teamName || "").trim();
    const device   = (body.device || event.headers["user-agent"] || "").slice(0,180);

    if (!teamCode || !pin) return bad(400, "teamCode and pin required");
    if (!/^\d{4}$/.test(pin)) return bad(400, "PIN must be 4 digits");

    // Find the team row for this event
    const teams = await listTeamsByEventId(eventId);
    const row = teams.find(r => String(r["Team Code"]).trim().toUpperCase() === teamCode);
    if (!row) return bad(404, "Team not found for this event");

    // Disallow auth if team is already locked/checked-in
    if (String(row["Locked"]||"").toUpperCase()==="TRUE") {
      return bad(403, "Team is locked (already checked in)");
    }

    // Fetch full teams sheet to get headers + exact row index for this row
    const sheets = await sheetsClient();
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "teams!A:Z",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const values  = data.values || [];
    const headers = (values[0] || []).map(String);

    const idx = values.findIndex((r, i) => {
      if (i === 0) return false;
      const obj = {};
      headers.forEach((h, j) => obj[h] = r[j]);
      return String(obj["Event Id"]).trim() === String(eventId).trim()
          && String(obj["Team Code"]).trim().toUpperCase() === teamCode;
    });
    if (idx < 1) return bad(500, "Unable to locate team row index for update");

    // Build mutable row object
    const current = {};
    headers.forEach((h, j) => current[h] = values[idx][j] !== undefined ? values[idx][j] : "");

    // --- PIN logic: treat anything not exactly 4 digits as "blank" (claim-on-first-login) ---
    let expectedPin = (current["PIN"] ?? "").toString().trim();
    if (!/^\d{4}$/.test(expectedPin)) expectedPin = "";

    if (expectedPin === "") {
      current["PIN"] = pin;         // create on first login
    } else if (expectedPin !== pin) {
      return bad(401, "Invalid PIN"); // once set, require match
    }

    // Optional updates
    if (teamName) current["Team Name"] = teamName;
    if (device)   current["Device"]    = device;
    current["LastSeen"] = new Date().toISOString();

    // Persist row
    const rowIndex1 = idx + 1;
    const outArr = headers.map(h => (current[h] !== undefined ? current[h] : ""));
    const range = `teams!A${rowIndex1}:${colLetter(headers.length)}${rowIndex1}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [outArr] },
    });

    // Issue token
    const token = signTeamToken({
      teamCode,
      teamName: current["Team Name"] || row["Team Name"] || teamCode,
      eventId,
      device
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
