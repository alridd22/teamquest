// netlify/functions/get_teams_for_event.js
const { readSheetAsObjects } = require('./_utils');  // <-- reuse your utils

function clean(s){ return String(s || '').trim(); }
function up(s){ return clean(s).toUpperCase(); }

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ success:false, code:'METHOD', message:'POST only' }) };
    }

    const { eventId = '' } = JSON.parse(event.body || '{}');
    if (!eventId) {
      return { statusCode: 400, body: JSON.stringify({ success:false, code:'BAD_REQUEST', message:'eventId is required' }) };
    }

    const SHEET_ID = process.env.GOOGLE_SHEET_ID;                  // you already have this
    const TAB_NAME = process.env.TEAMS_SHEET_NAME || 'teams';      // defaults to your "teams" tab

    // use your shared utils to read the tab into objects
    const rows = await readSheetAsObjects(SHEET_ID, `${TAB_NAME}!A1:J1000`);

    const teams = rows
      .filter(r => up(r['Event Id']) === up(eventId))
      .map(r => ({
        teamCode: clean(r['Team Code']),
        teamName: clean(r['Team Name']) || clean(r['Team Code'])
      }))
      .filter(t => t.teamCode);

    return {
      statusCode: 200,
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ success:true, teams }),
    };

  } catch (err) {
    console.error('[get_teams_for_event] error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success:false, code:'ERROR', message: err.message }),
    };
  }
};
