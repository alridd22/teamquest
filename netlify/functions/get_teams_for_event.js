// netlify/functions/get_teams_for_event.js
const { google } = require('googleapis');

function clean(s){ return String(s || '').trim(); }
function up(s){ return clean(s).toUpperCase(); }

// ---- ENV FALLBACKS ----
// Accept either raw email/key or a base64 JSON service account blob.
// Accept either TEAMS_SHEET_ID or GOOGLE_SHEET_ID.
// Default tab name to 'teams'.
function loadCredsFromEnv() {
  const env = process.env;

  // If JSON B64 is present, prefer it
  const b64 = env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 || env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (b64) {
    try {
      const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      return {
        email: json.client_email,
        privateKey: json.private_key,
      };
    } catch (e) {
      console.error('[get_teams_for_event] Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON_B64:', e);
    }
  }

  // Otherwise use discrete vars (support your existing names)
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL || env.GOOGLE_SERVICE_EMAIL;
  const privateKey =
    env.GOOGLE_PRIVATE_KEY ||
    env.GOOGLE_PRIVATE_KEY_BUILD || // your existing var
    '';

  return { email, privateKey };
}

const { email: SA_EMAIL, privateKey: SA_KEY } = loadCredsFromEnv();
const SHEET_ID = process.env.TEAMS_SHEET_ID || process.env.GOOGLE_SHEET_ID; // your existing var
const TAB_NAME = process.env.TEAMS_SHEET_NAME || 'teams'; // your screenshot shows "teams"

async function getSheetsClient() {
  if (!SA_EMAIL || !SHEET_ID || !SA_KEY) {
    throw new Error(
      'Missing Google envs. Need one of: GOOGLE_SERVICE_ACCOUNT_JSON_B64 OR (GOOGLE_SERVICE_EMAIL/GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY or GOOGLE_PRIVATE_KEY_BUILD), and TEAMS_SHEET_ID or GOOGLE_SHEET_ID.'
    );
  }
  const auth = new google.auth.JWT({
    email: SA_EMAIL,
    key: SA_KEY.replace(/\\n/g, '\n'), // handle escaped newlines from Netlify UI
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ success:false, code:'METHOD', message:'POST only' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const eventId = clean(body.eventId);
    if (!eventId) {
      return { statusCode: 400, body: JSON.stringify({ success:false, code:'BAD_REQUEST', message:'eventId is required' }) };
    }

    const sheets = await getSheetsClient();

    // Read a generous range from your "teams" tab (A..J as in your screenshot)
    const range = `${TAB_NAME}!A1:J1000`;
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range,
    });

    const rows = Array.isArray(data.values) ? data.values : [];
    if (!rows.length) {
      return { statusCode: 200, body: JSON.stringify({ success:true, teams: [] }) };
    }

    // Header → column indexes (case-insensitive)
    const header = rows[0].map(h => clean(h).toLowerCase());
    const idx = (name) => header.indexOf(name.toLowerCase());

    const iCode  = idx('team code');
    const iName  = idx('team name'); // optional
    const iEvent = idx('event id');

    if (iCode === -1 || iEvent === -1) {
      const msg = `Header row must include "Team Code" and "Event Id" in tab "${TAB_NAME}". Got: ${header.join(', ')}`;
      console.error('[get_teams_for_event] ' + msg);
      return { statusCode: 500, body: JSON.stringify({ success:false, code:'CONFIG', message: msg }) };
    }

    const wanted = up(eventId);

    const teams = rows.slice(1)
      .map(r => ({
        teamCode: clean(r[iCode]),
        teamName: (iName >= 0 ? clean(r[iName]) : '') || clean(r[iCode]),
        event: up(r[iEvent]),
      }))
      .filter(t => t.teamCode && t.event === wanted)
      .map(({ teamCode, teamName }) => ({ teamCode, teamName }));

    return {
      statusCode: 200,
      headers: { 'Content-Type':'application/json', 'Cache-Control':'no-store' },
      body: JSON.stringify({ success:true, teams }),
    };
  } catch (err) {
    console.error('[get_teams_for_event] error:', err && err.stack || err);
    return { statusCode: 500, body: JSON.stringify({ success:false, code:'ERROR', message: err?.message || 'Server error' }) };
  }
};
