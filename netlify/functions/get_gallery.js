// /netlify/functions/get_gallery.js
const { google } = require('googleapis');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const ok  = (b) => ({ statusCode:200, headers: CORS, body: JSON.stringify(b) });
const bad = (c,m) => ({ statusCode:c, headers: CORS, body: JSON.stringify({ success:false, message:m }) });

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || process.env.SPREADSHEET_ID || '';

function parseServiceAccount(){
  const raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GCP_SERVICE_ACCOUNT ||
    process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (raw) {
    const t = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(t);
  }
  const email =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL ||
    process.env.GCP_CLIENT_EMAIL || '';
  let key =
    process.env.GOOGLE_PRIVATE_KEY_B64
      ? Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, 'base64').toString('utf8')
      : (process.env.GOOGLE_PRIVATE_KEY || '');
  if (key) key = key.replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Missing service account credentials.');
  return { type:'service_account', client_email: email, private_key: key, token_uri: 'https://oauth2.googleapis.com/token' };
}

async function sheetsClient(){
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID / SPREADSHEET_ID');
  const sa = parseServiceAccount();
  const jwt = new google.auth.JWT(sa.client_email, undefined, sa.private_key, ['https://www.googleapis.com/auth/spreadsheets.readonly']);
  await jwt.authorize();
  return google.sheets({ version:'v4', auth: jwt });
}

function toText(...fields){ for (const f of fields){ const s = (f ?? '').toString().trim(); if (s) return s; } return ''; }
function listTitles(meta){ return (meta.data.sheets||[]).map(s=>s.properties.title); }
function findTitle(titles, wanted){ const low=wanted.toLowerCase(); return titles.find(t=>String(t).toLowerCase()===low) || wanted; }
function headIndex(row){ return Object.fromEntries((row||[]).map((h,i)=>[h,i])); }
function norm(v){ return String(v||'').trim().toUpperCase(); }

async function read(sheets, title){
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: title });
  const rows = r.data.values || [];
  const headers = rows[0] || [];
  const pos = headIndex(headers);
  return { rows, headers, pos };
}

exports.handler = async (event) => {
  try{
    if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
    const qs = event.queryStringParameters || {};
    const eventId = (qs.eventId || qs.event || '').toString().trim();

    const sheets = await sheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const titles = listTitles(meta);

    const eventsTitle   = findTitle(titles, 'events');
    const teamsTitle    = findTitle(titles, 'teams');
    const kindnessTitle = findTitle(titles, 'Kindness');
    const limerickTitle = findTitle(titles, 'Limerick');

    // Event state (for the page to know whether to reveal)
    const { rows:eRows, headers:eHdrs, pos:ePos } = await read(sheets, eventsTitle);
    let eRow = null;
    if (eRows.length > 1) {
      if (eventId) {
        const c = ePos['Event Id'];
        eRow = eRows.find((r,i)=> i>0 && String(r[c]||'').trim() === eventId) || null;
      } else {
        eRow = eRows[eRows.length - 1];
      }
    }
    const eObj = eRow ? Object.fromEntries(eHdrs.map((h,i)=>[h, eRow[i] ?? ''])) : {};
    const state = (eObj['State'] || '').toString().toUpperCase();

    // Teams lookup
    const { rows:tRows, headers:tHdrs, pos:tPos } = await read(sheets, teamsTitle);
    const colE = tPos['Event Id'] ?? tPos['eventId']; const colC = tPos['Team Code'] ?? tPos['teamCode'] ?? tPos['Code'];
    const colN = tPos['Name'] ?? tPos['Team Name'] ?? tPos['Team'];
    const codeToName = new Map();
    for (let i=1;i<tRows.length;i++){
      const r = tRows[i];
      if (eventId && colE != null && String(r[colE]||'').trim() !== eventId) continue;
      const code = norm(r[colC]);
      if (!code) continue;
      codeToName.set(code, toText(r[colN], code));
    }

    // Helper to pull entries from a sheet
    async function collect(title, activity){
      const { rows, headers, pos } = await read(sheets, title);
      if (rows.length < 2) return [];
      const pEvent = pos['Event Id'] ?? pos['eventId'];
      const pCode  = pos['Team Code'] ?? pos['teamCode'] ?? pos['Code'];
      const pText  = pos['Text'] ?? pos['Entry'] ?? pos['Limerick'] ?? pos['Description'] ?? pos['Story'];
      const pImg   = pos['ImageURL'] ?? pos['Image Url'] ?? pos['Photo'] ?? pos['PhotoURL'] ?? pos['Image'];
      const pStat  = pos['Status'] ?? pos['Approved'];

      const out = [];
      for (let i=1;i<rows.length;i++){
        const r = rows[i];
        if (pEvent != null && eventId && String(r[pEvent]||'').trim() !== eventId) continue;
        const code = norm(r[pCode]);
        if (!code) continue;

        // only show final/approved if column exists
        let show = true;
        if (pStat != null){
          const v = (r[pStat] || '').toString().trim().toLowerCase();
          show = (v === '' || v === 'final' || v === 'approved' || v === 'true');
        }
        if (!show) continue;

        out.push({
          activity,
          teamCode: code,
          teamName: codeToName.get(code) || code,
          text: toText(r[pText]),
          imageUrl: toText(r[pImg]),
        });
      }
      return out;
    }

    const kindness = await collect(kindnessTitle, 'kindness');
    const limerick = await collect(limerickTitle, 'limerick');

    return ok({
      success: true,
      eventId,
      state,
      published: state === 'PUBLISHED',
      kindness,
      limerick,
      lastUpdated: new Date().toISOString(),
    });
  }catch(err){
    console.error('get_gallery error:', err);
    return bad(500, err.message || 'Server error');
  }
};
