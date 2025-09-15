// /netlify/functions/admin_mark_return.js
const { google } = require('googleapis');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ok  = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c,m) => ({ statusCode: c, headers: CORS, body: JSON.stringify({ success:false, message:m }) });

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || process.env.SPREADSHEET_ID || '';

function parseServiceAccount() {
  // Prefer full JSON (raw or base64)…
  const rawJson =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GCP_SERVICE_ACCOUNT ||
    process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (rawJson) {
    const text = rawJson.trim().startsWith('{') ? rawJson : Buffer.from(rawJson, 'base64').toString('utf8');
    return JSON.parse(text);
  }
  // …or email + key (raw or base64)
  const email =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL ||
    process.env.GCP_CLIENT_EMAIL || '';
  let key =
    process.env.GOOGLE_PRIVATE_KEY_B64
      ? Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, 'base64').toString('utf8')
      : (process.env.GOOGLE_PRIVATE_KEY || '');
  if (key) key = key.replace(/\\n/g, '\n');
  if (!email || !key) {
    throw new Error('Missing service account creds (JSON or EMAIL + PRIVATE_KEY(_B64)).');
  }
  return { type:'service_account', client_email: email, private_key: key, token_uri: 'https://oauth2.googleapis.com/token' };
}

function tokenFromReq(event){
  const q = event.queryStringParameters || {};
  const h = event.headers || {};
  const a = h.authorization || h.Authorization;
  if (a && a.startsWith('Bearer ')) return a.slice(7).trim();
  if (q.key) return q.key.trim();
  return null;
}
// Accept: TQ_ADMIN_SECRET(S), ADMIN_API_KEYS, ADMIN_TOKEN
function allowedAdminKeys(){
  const list = [
    process.env.TQ_ADMIN_SECRET,
    process.env.TQ_ADMIN_SECRETS,
    process.env.ADMIN_API_KEYS,
    process.env.ADMIN_TOKEN,
  ].filter(Boolean).flatMap(v => String(v).split(',')).map(s=>s.trim()).filter(Boolean);
  return Array.from(new Set(list));
}
function isAllowed(token){ const list = allowedAdminKeys(); return list.length>0 && !!token && list.includes(token); }

async function sheetsClient(){
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID / SPREADSHEET_ID');
  const sa = parseServiceAccount();
  const jwt = new google.auth.JWT(sa.client_email, undefined, sa.private_key, ['https://www.googleapis.com/auth/spreadsheets']);
  await jwt.authorize();
  return google.sheets({ version:'v4', auth: jwt });
}
function colLetter(n){ let s=''; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26);} return s; }

async function readSheet(sheets, sheet){
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: sheet });
  const rows = r.data.values || [];
  const headers = rows[0] || [];
  const pos = Object.fromEntries(headers.map((h,i)=>[h,i]));
  return { rows, headers, pos };
}
async function updateRowPatch(sheets, sheet, rowIndex, headers, patch){
  const lastCol = colLetter(headers.length || 10);
  const cur = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID, range: `${sheet}!A${rowIndex}:${lastCol}${rowIndex}`
  });
  const row = cur.data.values?.[0] || new Array(headers.length).fill('');
  const pos = Object.fromEntries(headers.map((h,i)=>[h,i]));
  for (const [k,v] of Object.entries(patch)){ if (pos[k] != null) row[pos[k]] = v; }
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheet}!A${rowIndex}:${lastCol}${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });
}

exports.handler = async (event) => {
  try{
    if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers: CORS, body:'' };
    if (event.httpMethod !== 'POST') return bad(405, 'Use POST');

    const token = tokenFromReq(event);
    if (!isAllowed(token)) return bad(401, 'Unauthorized');

    let body; try { body = JSON.parse(event.body || '{}'); } catch { return bad(400, 'Invalid JSON'); }
    const eventId  = (body.eventId  || '').toString().trim();
    const teamCode = (body.teamCode || '').toString().trim();
    const undo     = !!body.undo;
    const whenIso  = (body.returnedAt && new Date(body.returnedAt).toISOString()) || new Date().toISOString();
    if (!eventId || !teamCode) return bad(400, 'Missing eventId or teamCode');

    const sheets = await sheetsClient();

    // Load teams
    const teamSheet = 'teams';
    const { rows:tRows, headers:tHdrs, pos:tPos } = await readSheet(sheets, teamSheet);
    if (tRows.length < 2) return bad(404, 'No teams found');

    const colEvent = tPos['Event Id'] ?? tPos['EventID'] ?? tPos['eventId'];
    const colCode  = tPos['Team Code'] ?? tPos['teamCode'] ?? tPos['Code'] ?? tPos['TEAM CODE'];
    if (colEvent == null || colCode == null) return bad(400, 'teams sheet missing Event Id / Team Code headers');

    let teamRowIndex = null;
    let teamRowObj = null;
    for (let i=1;i<tRows.length;i++){
      const vals = tRows[i];
      if ((vals[colEvent]||'').toString().trim() === eventId &&
          (vals[colCode] ||'').toString().trim() === teamCode){
        teamRowIndex = i+1;
        teamRowObj = Object.fromEntries(tHdrs.map((h,c)=>[h, vals[c] ?? '']));
        break;
      }
    }
    if (!teamRowIndex) return bad(404, 'Team not found for this event');

    // Optional: compute lateness / penalty using events sheet
    let minutesLate = 0, penalty = 0;
    if (!undo){
      const { rows:eRows, headers:eHdrs, pos:ePos } = await readSheet(sheets, 'events');
      const evIdx = eRows.findIndex((r,i)=> i>0 && (r[ePos['Event Id']]||'').toString().trim() === eventId);
      if (evIdx > 0){
        const evRow = Object.fromEntries(eHdrs.map((h,c)=>[h, eRows[evIdx][c] ?? '']));
        const endsAt = evRow['EndsAt (ISO)'] ? new Date(evRow['EndsAt (ISO)']).getTime() : null;
        const ppm = Number(evRow['PenaltyPerMin'] || 0);
        const ret = new Date(whenIso).getTime();
        if (endsAt){
          minutesLate = Math.max(0, Math.ceil((ret - endsAt)/60000));
          penalty = Math.max(0, minutesLate * ppm);
        }
      }
    }

    // Build patch for teams sheet (only set fields that exist)
    const patch = { 'UpdatedAt (ISO)': new Date().toISOString() };
    const has = (name) => tHdrs.includes(name);

    if (undo) {
      if (has('ReturnedAt (ISO)')) patch['ReturnedAt (ISO)'] = '';
      if (has('Returned'))         patch['Returned'] = '';
      if (has('LateMins'))         patch['LateMins'] = '';
      if (has('Penalty'))          patch['Penalty'] = '';
      if (has('LatePenalty'))      patch['LatePenalty'] = '';
    } else {
      if (has('ReturnedAt (ISO)')) patch['ReturnedAt (ISO)'] = whenIso;
      if (has('Returned'))         patch['Returned'] = 'TRUE';
      if (has('LateMins'))         patch['LateMins'] = minutesLate;
      if (has('Penalty'))          patch['Penalty'] = penalty;
      if (has('LatePenalty'))      patch['LatePenalty'] = penalty;
    }

    await updateRowPatch(sheets, teamSheet, teamRowIndex, tHdrs, patch);

    return ok({
      success: true,
      eventId, teamCode,
      returnedAt: undo ? '' : whenIso,
      minutesLate: undo ? 0 : minutesLate,
      penalty: undo ? 0 : penalty,
      undo,
    });

  } catch (err) {
    console.error('admin_mark_return error:', err);
    return bad(500, err.message || 'Server error');
  }
};
