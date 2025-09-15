// /netlify/functions/admin_start_event.js
const { google } = require('googleapis');

// ---------- CORS ----------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ---------- Env / Auth helpers ----------
function parseServiceAccount() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 || '';
  if (!b64) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON_B64');
  try { return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); }
  catch { return JSON.parse(b64); }
}
const SPREADSHEET_ID =
  process.env.GOOGLE_SHEET_ID || process.env.SPREADSHEET_ID || '';

function adminTokenFromRequest(event) {
  const q = event.queryStringParameters || {};
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  if (q.key) return q.key.trim();
  return null;
}

// ACCEPT: ADMIN_API_KEYS, ADMIN_TOKEN, TQ_ADMIN_SECRET, TQ_ADMIN_SECRETS
function allowedAdminKeys() {
  const vars = [
    process.env.ADMIN_API_KEYS,
    process.env.ADMIN_TOKEN,
    process.env.TQ_ADMIN_SECRET,
    process.env.TQ_ADMIN_SECRETS,
  ];
  const list = vars
    .filter(Boolean)
    .flatMap(v => String(v).split(','))
    .map(s => s.trim())
    .filter(Boolean);
  // de-dupe
  return Array.from(new Set(list));
}
function isAllowedAdmin(token) {
  const list = allowedAdminKeys();
  if (list.length === 0) return false; // hardened default
  return !!token && list.includes(token);
}

function ok(body)  { return { statusCode: 200, headers: CORS, body: JSON.stringify(body) }; }
function bad(code, msg){ return { statusCode: code, headers: CORS, body: JSON.stringify({ success:false, message: msg }) }; }

// ---------- Sheets helpers ----------
async function sheetsClient() {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID / SPREADSHEET_ID');
  const sa = parseServiceAccount();
  const jwt = new google.auth.JWT(sa.client_email, undefined, sa.private_key, [
    'https://www.googleapis.com/auth/spreadsheets',
  ]);
  await jwt.authorize();
  return google.sheets({ version: 'v4', auth: jwt });
}

function colLetter(n){ let s=''; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26);} return s; }

async function readSheetHeaders(sheets, sheetName) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!1:1`,
  });
  const headers = r.data.values?.[0] || [];
  return { headers, pos: Object.fromEntries(headers.map((h,i)=>[h,i])) };
}

async function findEventRow(sheets, sheetName, eventId) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
  });
  const rows = r.data.values || [];
  if (rows.length < 2) return { rowIndex:null, rowObj:null, headers: rows[0]||[] };

  const headers = rows[0];
  const pos = Object.fromEntries(headers.map((h,i)=>[h,i]));
  const colEvent = pos['Event Id'];
  for (let i=1;i<rows.length;i++){
    const vals = rows[i];
    if ((vals[colEvent] || '').toString().trim() === eventId) {
      return {
        rowIndex: i+1,
        headers,
        rowObj: Object.fromEntries(headers.map((h,c)=>[h, vals[c] ?? ''])),
      };
    }
  }
  return { rowIndex:null, rowObj:null, headers };
}

async function updateRowPatch(sheets, sheetName, rowIndex, headers, patch) {
  const lastCol = colLetter(headers.length || 10);
  const cur = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A${rowIndex}:${lastCol}${rowIndex}`,
  });
  const rowVals = cur.data.values?.[0] || new Array(headers.length).fill('');
  const pos = Object.fromEntries(headers.map((h,i)=>[h,i]));
  for (const [k,v] of Object.entries(patch)) {
    if (pos[k] != null) rowVals[pos[k]] = v;
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A${rowIndex}:${lastCol}${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [rowVals] },
  });
}

// ---------- Handler ----------
exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: CORS, body: '' };
    }
    if (event.httpMethod !== 'POST') return bad(405, 'Use POST');

    const token = adminTokenFromRequest(event);
    if (!isAllowedAdmin(token)) return bad(401, 'Unauthorized');

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return bad(400, 'Invalid JSON body'); }

    const eventId = (body.eventId || body.id || '').toString().trim();
    if (!eventId) return bad(400, 'Missing eventId');

    // Normalize action (accept stop=end)
    const actionIn = (body.action || 'start').toString().trim().toLowerCase();
    const action = (actionIn === 'stop') ? 'end' : actionIn;

    const sheets = await sheetsClient();
    const sheetName = 'events';

    // Find row
    const { rowIndex, rowObj, headers } = await findEventRow(sheets, sheetName, eventId);
    if (!rowIndex || !rowObj) return bad(404, `Event not found: ${eventId}`);

    const now = new Date();
    const nowIso = now.toISOString();
    const durationSec = Number(rowObj.DurationSec || rowObj['DurationSec'] || 0);

    // Mutators
    const setRunning = async () => {
      const startedAtIso = nowIso;
      const endsAtIso = new Date(now.getTime() + durationSec * 1000).toISOString();
      await updateRowPatch(sheets, sheetName, rowIndex, headers, {
        'State': 'RUNNING',
        'StartedAt (ISO)': startedAtIso,
        'EndsAt (ISO)': endsAtIso,
        'UpdatedAt (ISO)': nowIso,
      });
      return { success:true, eventId, state:'RUNNING', startedAt: startedAtIso, endsAt: endsAtIso, durationSec };
    };

    const setPaused = async () => {
      await updateRowPatch(sheets, sheetName, rowIndex, headers, {
        'State': 'PAUSED',
        'UpdatedAt (ISO)': nowIso,
      });
      return { success:true, eventId, state:'PAUSED' };
    };

    const setEnded = async () => {
      await updateRowPatch(sheets, sheetName, rowIndex, headers, {
        'State': 'ENDED',
        'UpdatedAt (ISO)': nowIso,
      });
      return { success:true, eventId, state:'ENDED' };
    };

    const setReset = async () => {
      await updateRowPatch(sheets, sheetName, rowIndex, headers, {
        'State': 'NOT_STARTED',
        'StartedAt (ISO)': '',
        'EndsAt (ISO)': '',
        'UpdatedAt (ISO)': nowIso,
      });
      return { success:true, eventId, state:'NOT_STARTED' };
    };

    // Execute
    let result;
    switch (action) {
      case 'start': result = await setRunning(); break;
      case 'pause': result = await setPaused();  break;
      case 'end':   result = await setEnded();   break;
      case 'reset': result = await setReset();   break;
      default: return bad(400, `Unknown action: ${actionIn}`);
    }

    return ok(result);
  } catch (err) {
    console.error('admin_start_event error:', err);
    return bad(500, err.message || 'Server error');
  }
};
