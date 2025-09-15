// /netlify/functions/admin_start_event.js
const { google } = require('googleapis');

// -------------- CORS --------------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ok  = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c, m) => ({ statusCode: c, headers: CORS, body: JSON.stringify({ success:false, message:m }) });

// -------------- ENV / AUTH --------------
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || process.env.SPREADSHEET_ID || '';

/**
 * Build service account creds from any of:
 * - GOOGLE_SERVICE_ACCOUNT_JSON_B64 (base64 of full JSON)
 * - GOOGLE_SERVICE_ACCOUNT_JSON (raw JSON)
 * - GCP_SERVICE_ACCOUNT / FIREBASE_SERVICE_ACCOUNT (raw or b64 JSON)
 * - GOOGLE_SERVICE_ACCOUNT_EMAIL + (GOOGLE_PRIVATE_KEY_B64 || GOOGLE_PRIVATE_KEY)
 */
function parseServiceAccount() {
  // Path A: full JSON (raw or base64) under common names
  const rawJsonCandidate =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GCP_SERVICE_ACCOUNT ||
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    '';

  if (rawJsonCandidate) {
    const text = rawJsonCandidate.trim().startsWith('{')
      ? rawJsonCandidate
      : Buffer.from(rawJsonCandidate, 'base64').toString('utf8');
    return JSON.parse(text);
  }

  // Path B: split email + key
  const email =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL ||
    process.env.GCP_CLIENT_EMAIL ||
    '';

  // Prefer b64 key, fall back to raw; also unescape \n if needed
  let pk =
    process.env.GOOGLE_PRIVATE_KEY_B64
      ? Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, 'base64').toString('utf8')
      : (process.env.GOOGLE_PRIVATE_KEY || '');

  if (pk) pk = pk.replace(/\\n/g, '\n'); // handle escaped newlines from env UI

  if (!email || !pk) {
    throw new Error(
      'Missing service account JSON (checked GOOGLE_SERVICE_ACCOUNT_JSON_B64 / GOOGLE_SERVICE_ACCOUNT_JSON / ' +
      'GCP_SERVICE_ACCOUNT / FIREBASE_SERVICE_ACCOUNT) OR missing pair GOOGLE_SERVICE_ACCOUNT_EMAIL + (GOOGLE_PRIVATE_KEY_B64|GOOGLE_PRIVATE_KEY)'
    );
  }

  return {
    type: 'service_account',
    client_email: email,
    private_key: pk,
    token_uri: 'https://oauth2.googleapis.com/token',
  };
}

function tokenFromReq(event){
  const q = event.queryStringParameters || {};
  const h = event.headers || {};
  const a = h.authorization || h.Authorization;
  if (a && a.startsWith('Bearer ')) return a.slice(7).trim();
  if (q.key) return q.key.trim();
  return null;
}

// Accept: ADMIN_API_KEYS, ADMIN_TOKEN, TQ_ADMIN_SECRET, TQ_ADMIN_SECRETS
function allowedAdminKeys(){
  const list = [
    process.env.ADMIN_API_KEYS,
    process.env.ADMIN_TOKEN,
    process.env.TQ_ADMIN_SECRET,
    process.env.TQ_ADMIN_SECRETS,
  ]
  .filter(Boolean)
  .flatMap(v => String(v).split(','))
  .map(s => s.trim())
  .filter(Boolean);
  return Array.from(new Set(list));
}
function isAllowed(token){
  const list = allowedAdminKeys();
  return list.length > 0 && !!token && list.includes(token);
}

// -------------- SHEETS HELPERS --------------
async function sheetsClient(){
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID / SPREADSHEET_ID');
  const sa = parseServiceAccount();
  const jwt = new google.auth.JWT(sa.client_email, undefined, sa.private_key, [
    'https://www.googleapis.com/auth/spreadsheets',
  ]);
  await jwt.authorize();
  return google.sheets({ version:'v4', auth: jwt });
}
function colLetter(n){ let s=''; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26);} return s; }

async function findEventRow(sheets, sheetName, eventId){
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: sheetName });
  const rows = r.data.values || [];
  if (rows.length < 2) return { rowIndex:null, rowObj:null, headers: rows[0] || [] };

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

async function updateRowPatch(sheets, sheetName, rowIndex, headers, patch){
  const lastCol = colLetter(headers.length || 10);
  const cur = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A${rowIndex}:${lastCol}${rowIndex}`,
  });
  const row = cur.data.values?.[0] || new Array(headers.length).fill('');
  const pos = Object.fromEntries(headers.map((h,i)=>[h,i]));
  for (const [k,v] of Object.entries(patch)) if (pos[k] != null) row[pos[k]] = v;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A${rowIndex}:${lastCol}${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });
}

// -------------- HANDLER --------------
exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers: CORS, body:'' };
    if (event.httpMethod !== 'POST') return bad(405, 'Use POST');

    // Admin auth
    const token = tokenFromReq(event);
    if (!isAllowed(token)) return bad(401, 'Unauthorized');

    // Body
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return bad(400, 'Invalid JSON body'); }

    const eventId = (body.eventId || body.id || '').toString().trim();
    if (!eventId) return bad(400, 'Missing eventId');

    // Action (accept stop=end)
    const actionIn = (body.action || 'start').toString().trim().toLowerCase();
    const action = (actionIn === 'stop') ? 'end' : actionIn;

    // Sheets
    const sheets = await sheetsClient();
    const sheetName = 'events';
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
