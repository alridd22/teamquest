const { google } = require('googleapis');

/* ---------- CORS + helpers ---------- */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret, X-Idempotency-Key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ok  = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c,m) => ({ statusCode: c, headers: CORS, body: JSON.stringify({ success:false, message:m }) });

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || process.env.SPREADSHEET_ID || '';

/* ---------- Admin auth (accept both styles) ---------- */
function tokenFromReq(event){
  const q = event.queryStringParameters || {};
  const h = event.headers || {};
  const a = h.authorization || h.Authorization;
  if (a && a.startsWith('Bearer ')) return a.slice(7).trim();
  if (h['x-admin-secret'] || h['X-Admin-Secret']) return (h['x-admin-secret'] || h['X-Admin-Secret']).toString().trim();
  if (q.key) return q.key.trim();
  return null;
}
function allowedAdminKeys(){
  const list = [
    process.env.TQ_ADMIN_SECRET,
    process.env.TQ_ADMIN_SECRETS,
    process.env.ADMIN_API_KEYS,
    process.env.ADMIN_TOKEN,
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

/* ---------- Sheets client (memoized) ---------- */
let SHEETS = null;
let AUTH   = null;

function parseServiceAccount() {
  const rawJson =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GCP_SERVICE_ACCOUNT ||
    process.env.FIREBASE_SERVICE_ACCOUNT || '';

  if (rawJson) {
    const text = rawJson.trim().startsWith('{')
      ? rawJson
      : Buffer.from(rawJson, 'base64').toString('utf8');
    return JSON.parse(text);
  }

  const email =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_SERVICE_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL ||
    process.env.GCP_CLIENT_EMAIL || '';

  let key =
    process.env.GOOGLE_PRIVATE_KEY_B64
      ? Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, 'base64').toString('utf8')
      : (process.env.GOOGLE_PRIVATE_KEY || '');

  if (key) key = key.replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Missing service account creds.');
  return { client_email: email, private_key: key };
}

async function getAuth(){
  if (AUTH) return AUTH;
  const sa = parseServiceAccount();
  const jwt = new google.auth.JWT(
    sa.client_email,
    undefined,
    sa.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  await jwt.authorize();
  AUTH = jwt;
  return AUTH;
}

async function sheetsClient(){
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID / SPREADSHEET_ID');
  if (SHEETS) return SHEETS;
  const auth = await getAuth();
  SHEETS = google.sheets({ version:'v4', auth });
  return SHEETS;
}

/* ---------- Sheet helpers ---------- */
function lcHeaders(row = []) {
  const out = {};
  (row || []).forEach((h,i)=>{
    out[String(h || '').trim().toLowerCase()] = i;
  });
  return out;
}

async function readTab(sheets, title){
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${title}!A:Z`
  });
  const values = r.data.values || [];
  return { header: values[0] || [], rows: values.slice(1) };
}

function colLetter(n){
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function updateRowPatch(sheets, sheet, rowIndex, headers, patch){
  const lastCol = colLetter(headers.length || 10);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheet}!A${rowIndex}:${lastCol}${rowIndex}`
  });
  const row = res.data.values?.[0] || new Array(headers.length).fill('');
  const idx = {};
  headers.forEach((h,i)=> { idx[h] = i; });

  for (const [k,v] of Object.entries(patch)){
    if (idx[k] != null) row[idx[k]] = v;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheet}!A${rowIndex}:${lastCol}${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });
}

/* ---------- Handler ---------- */
exports.handler = async (event) => {
  try{
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: CORS, body: '' };
    }
    if (event.httpMethod !== 'POST') {
      return bad(405, 'Use POST');
    }

    const token = tokenFromReq(event);
    if (!isAllowed(token)) return bad(401, 'Unauthorized');

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return bad(400, 'Invalid JSON');
    }

    const eventId  = (body.eventId  || '').toString().trim();
    const teamCode = (body.teamCode || '').toString().trim();
    const undo     = !!body.undo;
    const whenIso  =
      (body.returnedAt && new Date(body.returnedAt).toISOString()) ||
      new Date().toISOString();

    if (!eventId || !teamCode) return bad(400, 'Missing eventId or teamCode');

    // We still accept X-Idempotency-Key header for logging / future use,
    // but we no longer do in-memory dedupe that can mask failed writes.
    const idemHeader =
      (event.headers['x-idempotency-key'] || event.headers['X-Idempotency-Key'] || '')
        .toString()
        .trim();
    const idemKey = idemHeader || `return:${eventId}:${teamCode}:${undo ? 'undo' : 'mark'}`;

    const sheets = await sheetsClient();

    // ---- Read teams tab once ----
    const teamSheet = 'teams';
    const { header: tHdr, rows: tRows } = await readTab(sheets, teamSheet);
    const tIdx = lcHeaders(tHdr);
    const iEvt  = tIdx['event id']  ?? tIdx['eventid'];
    const iCode = tIdx['team code'] ?? tIdx['teamcode'] ?? tIdx['code'];

    if (iEvt == null || iCode == null) {
      return bad(400, 'teams sheet missing Event Id / Team Code headers');
    }

    let rowIdx = -1;
    const current = {};

    for (let r = 0; r < tRows.length; r++){
      const row = tRows[r];
      if (
        ((row[iEvt]  || '').toString().trim() === eventId) &&
        ((row[iCode] || '').toString().trim() === teamCode)
      ){
        rowIdx = r + 2; // header row + 1-based index
        tHdr.forEach((h,i)=> { current[h] = row[i] ?? ''; });
        break;
      }
    }

    if (rowIdx < 0) return bad(404, 'Team not found for this event');

    // ---- Compute penalty if needed ----
    let minutesLate = 0;
    let penalty     = 0;

    if (!undo) {
      try {
        const { header: eHdr, rows: eRows } = await readTab(sheets, 'events');
        const eIdx  = lcHeaders(eHdr);
        const eiEvt = eIdx['event id'] ?? eIdx['eventid'];
        const eiEnds= eIdx['endsat (iso)'] ?? eIdx['endsat'];
        const eiPPM = eIdx['penaltypermin'] ??
                      eIdx['penalty per min'] ??
                      eIdx['penalty/min'] ??
                      eIdx['penalty'];

        const row = eRows.find(r => (r[eiEvt] || '').toString().trim() === eventId);
        if (row) {
          const endsAt = row[eiEnds] ? new Date(row[eiEnds]).getTime() : null;
          const ppm    = Number(row[eiPPM] || 0) || 0;
          const ret    = new Date(whenIso).getTime();

          if (endsAt) {
            minutesLate = Math.max(0, Math.ceil((ret - endsAt) / 60000));
            penalty     = Math.max(0, minutesLate * ppm);
          }
        }
      } catch {
        // tolerate missing / malformed events tab
      }
    }

    const has = (name) => tHdr.includes(name);

    const alreadyReturned =
      String(current['Returned'] || '').toUpperCase() === 'TRUE' ||
      !!current['ReturnedAt (ISO)'];

    const desiredReturned = !undo;

    // ---- Logical idempotency based on row state ----
    if ((desiredReturned && alreadyReturned) || (!desiredReturned && !alreadyReturned)) {
      const existingPenalty =
        Number(current['LatePenalty'] || current['Penalty'] || 0) || 0;

      return ok({
        success: true,
        eventId,
        teamCode,
        returnedAt: desiredReturned
          ? (current['ReturnedAt (ISO)'] || whenIso)
          : '',
        minutesLate: desiredReturned ? minutesLate : 0,
        penalty: desiredReturned ? (existingPenalty || penalty) : 0,
        undo,
        idempotency: idemKey
      });
    }

    // ---- Patch row ----
    const patch = { 'UpdatedAt (ISO)': new Date().toISOString() };

    if (desiredReturned) {
      if (has('ReturnedAt (ISO)')) patch['ReturnedAt (ISO)'] = whenIso;
      if (has('Returned'))         patch['Returned']         = 'TRUE';
      if (has('LateMins'))         patch['LateMins']         = minutesLate;
      if (has('Penalty'))          patch['Penalty']          = penalty;
      if (has('LatePenalty'))      patch['LatePenalty']      = penalty;
    } else {
      if (has('ReturnedAt (ISO)')) patch['ReturnedAt (ISO)'] = '';
      if (has('Returned'))         patch['Returned']         = '';
      if (has('LateMins'))         patch['LateMins']         = '';
      if (has('Penalty'))          patch['Penalty']          = '';
      if (has('LatePenalty'))      patch['LatePenalty']      = '';
    }

    await updateRowPatch(sheets, teamSheet, rowIdx, tHdr, patch);

    return ok({
      success: true,
      eventId,
      teamCode,
      returnedAt: desiredReturned ? whenIso : '',
      minutesLate: desiredReturned ? minutesLate : 0,
      penalty: desiredReturned ? penalty : 0,
      undo,
      idempotency: idemKey
    });

  } catch (err) {
    console.error('admin_mark_return error:', err);
    return bad(500, err.message || 'Server error');
  }
};
