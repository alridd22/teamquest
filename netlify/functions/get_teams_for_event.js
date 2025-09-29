// get_teams_for_event.js
import { google } from 'googleapis';

const {
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  TEAMS_SHEET_ID,       // <-- reuse your existing Sheet ID var
  TEAMS_SHEET_NAME='Teams' // or the tab name holding the grid you showed
} = process.env;

function clean(s){ return String(s || '').trim(); }
function normEvent(s){ return clean(s).toUpperCase(); }

async function getSheets() {
  const auth = new google.auth.JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

export default async (req) => {
  try {
    const isPost = req.method === 'POST';
    const body = isPost ? await req.json().catch(()=> ({})) : {};
    const url = new URL(req.url);
    const eventId = clean(body.eventId || url.searchParams.get('eventId'));
    if (!eventId) {
      return new Response(JSON.stringify({ success:false, code:'BAD_REQUEST', message:'eventId is required' }), { status:400 });
    }

    const sheets = await getSheets();

    // Read the whole table (adjust range if your tab name differs)
    const range = `${TEAMS_SHEET_NAME}!A1:J1000`;
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: TEAMS_SHEET_ID,
      range
    });

    const rows = Array.isArray(data.values) ? data.values : [];
    if (!rows.length) {
      return new Response(JSON.stringify({ success:true, teams: [] }), { status:200 });
    }

    // Header mapping
    const header = rows[0].map(h => clean(h).toLowerCase());
    const idx = (name) => header.indexOf(name.toLowerCase());

    const iCode   = idx('team code');
    const iName   = idx('team name');
    const iPin    = idx('pin');           // not returned
    const iEvent  = idx('event id');
    const iLocked = idx('locked');        // optional

    const wantedEvent = normEvent(eventId);

    const teams = rows.slice(1)
      .map(r => ({
        teamCode: clean(r[iCode]),
        teamName: clean(r[iName]) || clean(r[iCode]),
        eventId:  normEvent(r[iEvent]),
        locked:   clean(r[iLocked]),
        // pin:    clean(r[iPin])  // NEVER return PINs
      }))
      .filter(t => t.teamCode)             // must have a code
      .filter(t => t.eventId === wantedEvent);

    return new Response(JSON.stringify({ success:true, teams }), {
      status: 200,
      headers: { 'Content-Type':'application/json', 'Cache-Control': 'no-store' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ success:false, code:'ERROR', message: err?.message || 'Server error' }), { status:500 });
  }
}
