// netlify/functions/get_teams_for_event.js
const { google } = require('googleapis');

const {
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  TEAMS_SHEET_ID            // spreadsheet ID only
} = process.env;

function clean(s){ return String(s || '').trim(); }
function up(s){ return clean(s).toUpperCase(); }

async function getSheetsClient() {
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !TEAMS_SHEET_ID) {
    throw new Error('Missing env vars: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, TEAMS_SHEET_ID');
  }
  const auth = new google.auth.JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

async function findTeamsTab(sheets) {
  // Look through all tabs; pick the one whose first row contains Team Code + Event Id
  const meta = await sheets.spreadsheets.get({ spreadsheetId: TEAMS_SHEET_ID });
  const tabs = meta.data.sheets || [];
  for (const s of tabs) {
    const title = s.properties?.title;
    if (!title) continue;
    try {
      const { data } = await sheets.spreadsheets.values.get({
        spreadsheetId: TEAMS_SHEET_ID,
        range: `${title}!A1:Z1`,
      });
      const header = (data.values && data.values[0]) ? data.values[0].map(h => clean(h).toLowerCase()) : [];
      const hasTeamCode = header.includes('team code');
      const hasEventId  = header.includes('event id');
      if (hasTeamCode && hasEventId) return title;
    } catch (_) { /* ignore and try next tab */ }
  }
  throw new Error('Could not find a sheet tab with a header row containing "Team Code" and "Event Id".');
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

    // Auto-detect the correct tab by header names
    const tab = await findTeamsTab(sheets);

    // Read a generous range from that tab
    const range = `${tab}!A1:J1000`;
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: TEAMS_SHEET_ID,
      range,
    });

    const rows = Array.isArray(data.values) ? data.values : [];
    if (!rows.length) {
      return { statusCode: 200, body: JSON.stringify({ success:true, teams: [] }) };
    }

    const header = rows[0].map(h => clean(h).toLowerCase());
    const idx = (name) => header.indexOf(name.toLowerCase());

    const iCode  = idx('team code');
    const iName  = idx('team name'); // optional; we fall back to code
    const iEvent = idx('event id');

    if (iCode === -1 || iEvent === -1) {
      const msg = `Header row must include "Team Code" and "Event Id". Found: ${header.join(', ')}`;
      console.error('[get_teams_for_event] ' + msg);
      return { statusCode: 500, body: JSON.stringify({ success:false, code:'CONFIG', message: msg }) };
    }

    const wanted = up(eventId);

    const teams = rows.slice(1)
      .map(r => ({
        teamCode: clean(r[iCode]),
        teamName: (iName >= 0 ? clean(r[iName]) : '') || clean(r[iCode]),
        event: up(r[iEvent])
      }))
      .filter(t => t.teamCode && t.event === wanted)
      .map(({ teamCode, teamName }) => ({ teamCode, teamName }));

    return {
      statusCode: 200,
      headers: { 'Content-Type':'application/json', 'Cache-Control':'no-store' },
      body: JSON.stringify({ success:true, teams, tab }),
    };
  } catch (err) {
    console.error('[get_teams_for_event] error:', err && err.stack || err);
    return { statusCode: 500, body: JSON.stringify({ success:false, code:'ERROR', message: err?.message || 'Server error' }) };
  }
};
