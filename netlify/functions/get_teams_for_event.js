// netlify/functions/get_teams_for_event.js
const U = require('./_utils');

function clean(s){ return String(s || '').trim(); }
function up(s){ return clean(s).toUpperCase(); }

function rowsToObjects(values){
  const rows = Array.isArray(values) ? values : [];
  if (!rows.length) return [];
  const header = rows[0].map(h => String(h || '').trim());
  return rows.slice(1).map(r => {
    const o = {};
    header.forEach((h,i)=> { o[h] = r[i]; });
    return o;
  });
}

async function readTeamsRows(sheetId, tabName){
  const range = `${tabName}!A1:J1000`;

  // 1) Try obvious helpers your utils might export
  if (typeof U.readSheetAsObjects === 'function') {
    return await U.readSheetAsObjects(sheetId, range);
  }
  if (typeof U.readSheetRangeAsObjects === 'function') {
    return await U.readSheetRangeAsObjects(sheetId, range);
  }
  if (typeof U.readSheetRange === 'function') {
    const values = await U.readSheetRange(sheetId, range);
    return rowsToObjects(values);
  }

  // 2) If utils can give us an authenticated Sheets client, use it
  if (typeof U.getSheetsClient === 'function' || typeof U.sheetsClient === 'function') {
    const sheets = await (U.getSheetsClient?.() || U.sheetsClient?.());
    const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
    return rowsToObjects(data.values);
  }

  // 3) Last resort: do our own auth (only if creds are present)
  const { google } = require('googleapis');
  const email = process.env.GOOGLE_SERVICE_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY_BUILD || process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g,'\n');

  if (!email || !key) {
    throw new Error('Google credentials are not available to Functions at runtime. Ensure GOOGLE_SERVICE_EMAIL and GOOGLE_PRIVATE_KEY_BUILD (or JSON_B64) are scoped to Functions/Runtime.');
  }

  const auth = new google.auth.JWT({ email, key, scopes:['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await auth.authorize();
  const sheets = google.sheets({ version:'v4', auth });
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  return rowsToObjects(data.values);
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ success:false, code:'METHOD', message:'POST only' }) };
    }

    const { eventId = '' } = JSON.parse(event.body || '{}');
    if (!eventId) {
      return { statusCode: 400, body: JSON.stringify({ success:false, code:'BAD_REQUEST', message:'eventId is required' }) };
    }

    const SHEET_ID = process.env.GOOGLE_SHEET_ID || process.env.TEAMS_SHEET_ID;
    const TAB_NAME = process.env.TEAMS_SHEET_NAME || 'teams';
    if (!SHEET_ID) {
      return { statusCode: 500, body: JSON.stringify({ success:false, code:'CONFIG', message:'Missing GOOGLE_SHEET_ID (or TEAMS_SHEET_ID)' }) };
    }

    const rows = await readTeamsRows(SHEET_ID, TAB_NAME);

    const teams = rows
      .filter(r => up(r['Event Id']) === up(eventId))
      .map(r => ({
        teamCode: clean(r['Team Code']),
        teamName: clean(r['Team Name']) || clean(r['Team Code'])
      }))
      .filter(t => t.teamCode);

    return {
      statusCode: 200,
      headers: { 'Content-Type':'application/json', 'Cache-Control':'no-store' },
      body: JSON.stringify({ success:true, teams }),
    };
  } catch (err) {
    console.error('[get_teams_for_event] error:', err);
    return { statusCode: 500, body: JSON.stringify({ success:false, code:'ERROR', message: err.message }) };
  }
};
