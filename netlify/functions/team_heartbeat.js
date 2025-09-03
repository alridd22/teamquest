// /netlify/functions/team_heartbeat.js
const { ok, bad, getBody } = require("./_lib/http");
const { verifyTeamToken } = require("./_lib/auth");
const { google } = require("googleapis");
const { JWT } = require("google-auth-library");
const fs = require("fs");
const path = require("path");

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
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      const client_email = j.client_email || SERVICE_EMAIL_ENV;
      const private_key = String(j.private_key || "").replace(/\\n/g, "\n");
      if (client_email && private_key) return { client_email, private_key };
    } catch {}
  }
  throw new Error("Service Account creds not available at runtime for heartbeat");
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
    const { token, device } = getBody(event);
    if (!token) return bad(400, "token required");

    let claims;
    try {
      claims = verifyTeamToken(token);
    } catch (e) {
      return bad(401, "Invalid token");
    }

    const { teamCode, eventId } = claims;
    const sheets = await sheetsClient();
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "teams!A:Z",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const headers = (data.values?.[0] || []).map(String);
    const rows = data.values || [];
    const idx = rows.findIndex((r, i) => {
      if (i === 0) return false;
      const obj = {}; headers.forEach((h, j) => obj[h] = r[j]);
      return String(obj["Event Id"]).trim() === String(eventId).trim()
          && String(obj["Team Code"]).trim() === String(teamCode).trim();
    });
    if (idx < 1) return bad(404, "Team not found");

    const nowIso = new Date().toISOString();
    const current = {};
    headers.forEach((h, j) => current[h] = rows[idx][j] !== undefined ? rows[idx][j] : "");
    current["LastSeen"] = nowIso;
    if (device) current["Device"] = String(device).slice(0,180);

    const outArr = headers.map(h => (current[h] !== undefined ? current[h] : ""));
    const rowIndex = idx + 1;
    const range = `teams!A${rowIndex}:${colLetter(headers.length)}${rowIndex}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [outArr] },
    });

    return ok({ success: true, lastSeen: nowIso });
  } catch (e) {
    return bad(e.status || 500, e.message || "Error");
  }
};
