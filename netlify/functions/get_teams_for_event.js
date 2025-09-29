// netlify/functions/get_teams_for_event.js
const { google } = require('googleapis');

const SERVICE_EMAIL = process.env.GOOGLE_SERVICE_EMAIL;          // already in your site
const PRIVATE_KEY   = (process.env.GOOGLE_PRIVATE_KEY_BUILD || '') // already in your site
  .replace(/\\n/g, '\n');                                          // handle escaped newlines
const SHEET_ID      = process.env.GOOGLE_SHEET_ID;                 // already in your site
const TAB_NAME      = process.env.TEAMS_SHEET_NAME || 'teams';     // default to your tab name

function clean(s){ return String(s || '').trim(); }
function up(s){ return clean(s).toUpperCase(); }

async function sheetsClient() {
  if (!SERVICE_EMAIL || !PRIVATE_KEY || !SHEET_ID) {
    // Keep the message super specific to the three vars we actually require
    throw new Error('Missing GOOGLE_SERVICE_EMAIL or GOOGLE_PRIVATE_KEY_BUILD or GOOGLE_SHEET_ID');
  }
  const auth = new google.auth.JWT({
    email: SERVICE_EMAIL,
    key: PRIVATE_KEY,
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

    const sheets = await sheetsClient();

    // Read rows from the teams tab (A..J matches your screenshot)
    const range = `${TAB_NAME}!A1:J1000`;
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range,
    });

    const rows = Array.isArray(data.values) ? data.values : [];
    if (!rows.length) {
      return { statusCode: 200, body: JSON.stringify({ success:true, teams: [] }) };
    }

    // header → indexes (case-insensitive)
    const header = rows[0].map(h => clean(h).toLowerCase());
    const idx = (name) => header.indexOf(name.toLowerCase());

    const iCode  = idx('team code');
    const iName  = idx('team name'); // optional
    const iEvent = idx('event id');

    if (iCode === -1 || iEvent === -1) {
      const msg = `Header must include "Team Code" and "Event Id" in tab "${TAB_NAME}". Found: ${header.join(', ')}`;
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
