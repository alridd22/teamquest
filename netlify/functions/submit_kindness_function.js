// /.netlify/functions/submit_kindness_function.js
// Kindness submission (Zapier-compatible row shape)
//
// Writes rows that match your historic columns so Zapier keeps working:
//
// A Timestamp     | B Team Code | C Activity | D Nonce
// E Payload (JSON)| F AI Status | G AI Attempts | H AI Score
// I Final Score   | J Idempotency | K Event Id
//
// Auth: accepts Bearer team JWT if present; otherwise allows teamCode-only
// by confirming the team exists in the Teams tab.
//
// Env: reuses your _utils.js if present (same auth/env as the hardened funcs).
// Spreadsheet id is taken from GOOGLE_SHEET_ID (or the usual fallbacks).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ok  = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c, m) => ({ statusCode: c, headers: CORS, body: JSON.stringify({ success:false, message:m }) });

let U = null;
try { U = require('./_utils'); } catch {}

function getSpreadsheetId() {
  return (
    (U && (U.SPREADSHEET_ID || U.SHEET_ID || U.spreadsheetId)) ||
    process.env.GOOGLE_SHEET_ID ||
    process.env.SPREADSHEET_ID ||
    process.env.SHEET_ID ||
    ''
  );
}

async function getSheets() {
  // Prefer your shared utils wiring
  if (U) {
    if (typeof U.getSheetsClient === 'function') return await U.getSheetsClient();
    if (typeof U.getSheets === 'function') {
      const s = await U.getSheets();
      if (s?.spreadsheets?.values?.get) return s;
      if (s?.sheets?.spreadsheets?.values?.get) return s.sheets;
    }
    if (U.sheets?.spreadsheets?.values?.get) return U.sheets;
    if (U.google && U.auth && typeof U.google.sheets === 'function') {
      return U.google.sheets({ version:'v4', auth: U.auth });
    }
  }

  // Fallback: direct googleapis with flexible env
  const { google } = require('googleapis');
  let raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GCP_SERVICE_ACCOUNT ||
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    '';
  let sa = null;
  if (raw) {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    sa = JSON.parse(text);
  } else {
    const email =
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
      process.env.GCP_SA_EMAIL ||
      process.env.GCLOUD_CLIENT_EMAIL ||
      process.env.SERVICE_ACCOUNT_EMAIL || '';
    let key =
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
      process.env.GCP_SA_KEY ||
      process.env.GCLOUD_PRIVATE_KEY ||
      process.env.SERVICE_ACCOUNT_PRIVATE_KEY || '';
    if (email && key) {
      key = key.replace(/\\n/g, '\n');
      sa = { client_email: email, private_key: key };
    }
  }
  if (!sa) throw new Error('Missing Google service account (set JSON or EMAIL/PRIVATE_KEY)');

  const auth = new google.auth.JWT(sa.client_email, null, sa.private_key, [
    'https://www.googleapis.com/auth/spreadsheets',
  ]);
  await auth.authorize();
  return google.sheets({ version:'v4', auth });
}

// Optional: decode team JWT if present (silently ignore errors)
async function getTeamFromAuth(event) {
  const hdr = event.headers || {};
  const authz = hdr.authorization || hdr.Authorization || '';
  if (!authz?.startsWith?.('Bearer ')) return null;
  const token = authz.slice(7).trim();

  if (U) {
    try {
      if (typeof U.verifyTeamToken === 'function') return await U.verifyTeamToken(token);
      if (typeof U.verifyJwt === 'function')       return await U.verifyJwt(token);
    } catch { /* ignore */ }
  }
  try {
    const jwt = require('jsonwebtoken');
    const secret = process.env.TQ_TEAM_JWT_SECRET || process.env.JWT_SECRET || process.env.SECRET;
    if (!secret) return null;
    return jwt.verify(token, secret);
  } catch { return null; }
}

const norm = (s='') => String(s).toLowerCase().replace(/[^a-z0-9]+/g,'');
const findIdx = (hdrs, names) => {
  const H = hdrs.map(norm);
  for (const n of names) { const i = H.indexOf(norm(n)); if (i >= 0) return i; }
  return -1;
};

async function teamExists(sheets, spreadsheetId, code) {
  const ranges = ['teams!A:Z','Teams!A:Z','TEAMS!A:Z'];
  for (const range of ranges) {
    try {
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
      const rows = resp.data.values || [];
      if (!rows.length) continue;
      const headers = rows[0];
      const idxCode = findIdx(headers, ['teamcode','code','team_code','id','team id','crew code','crew id']);
      if (idxCode < 0) continue;
      const found = rows.slice(1).some(r => (r[idxCode] || '').toString().trim() === code);
      if (found) return true;
    } catch {}
  }
  return false;
}

// Look for an existing row by Idempotency or by (eventId + teamCode + activity)
async function alreadySubmitted(sheets, spreadsheetId, activity, teamCode, eventId, idemKey) {
  const ranges = ['submissions!A:Z','Submissions!A:Z'];
  for (const range of ranges) {
    try {
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
      const rows = resp.data.values || [];
      if (!rows.length) continue;
      const headers = rows[0];
      const idxIdem  = findIdx(headers, ['idempotency','idem','idempotencykey']);
      const idxAct   = findIdx(headers, ['activity','type']);
      const idxTeam  = findIdx(headers, ['teamcode','team','team_code','code','crew','crewcode']);
      const idxEvent = findIdx(headers, ['eventid','event','event_id']);

      for (const r of rows.slice(1)) {
        const idemOk = idxIdem >= 0 && (r[idxIdem] || '').toString().trim() === idemKey;
        const tripOk = (idxAct<0 || norm(r[idxAct]||'')===norm(activity))
                    && (idxTeam<0 || (r[idxTeam]||'').toString().trim()===teamCode)
                    && (idxEvent<0 || (r[idxEvent]||'').toString().trim()===eventId);
        if (idemOk || tripOk) return true;
      }
    } catch {}
  }
  return false;
}

async function appendRowZapierShape(sheets, spreadsheetId, row) {
  const targets = ['submissions!A:K','Submissions!A:K'];
  for (const range of targets) {
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] },
      });
      return true;
    } catch {}
  }
  throw new Error('Could not append to submissions/Submissions A:K');
}

const ts = () => new Date().toISOString().slice(0,19).replace('T',' ');
const makeNonce = () => `kindness-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
const makeIdem  = (eventId, teamCode) => `kindness|${eventId}|${teamCode}`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({ success:true });
  if (event.httpMethod !== 'POST')   return bad(405,'Use POST');

  console.info('Kindness submission started');

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return bad(400,'Invalid JSON'); }

  const eventId = (body.eventId || body.event || '').toString().trim();
  let teamCode  = (body.teamCode || body.team || '').toString().trim();

  // Prefer team from JWT if present
  const claims = await getTeamFromAuth(event);
  if (claims?.teamCode) teamCode = claims.teamCode;

  // Payload fields (flexible aliases)
  const description = (body.description || body.text || body.story || body.storyText || body.desc || '').toString().trim();
  const location    = (body.location || body.place || body.where || '').toString().trim();
  const photoUrl    = (body.photoUrl || body.imageUrl || body.imgUrl || body.url || body.photo || '').toString().trim();

  if (!eventId)  return bad(400,'Missing eventId');
  if (!teamCode) return bad(400,'Missing teamCode (sign in first)');
  if (!description || description.length < 5) return bad(400,'Please include a short description');
  if (!photoUrl) return bad(400,'Please include a photoUrl (Uploadcare URL)');

  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) return bad(500,'Missing GOOGLE_SHEET_ID / SPREADSHEET_ID');

  try {
    // optional: respect event state if your utils expose it
    if (U && typeof U.getEventState === 'function') {
      const state = await U.getEventState(eventId).catch(()=>null);
      if (state && state !== 'RUNNING') {
        return bad(400, `Event state is ${state}; submissions are closed`);
      }
    }

    const sheets = await getSheets();

    // If no JWT, at least validate the team exists
    if (!claims?.teamCode) {
      const exists = await teamExists(sheets, spreadsheetId, teamCode);
      if (!exists) return bad(401,'Unknown teamCode');
    }

    const activity = 'kindness';
    const nonce = makeNonce();
    const idempotencyKey = makeIdem(eventId, teamCode);

    // De-dupe: one kindness per team/event
    if (await alreadySubmitted(sheets, spreadsheetId, activity, teamCode, eventId, idempotencyKey)) {
      return ok({ success:true, message:'Already submitted' });
    }

    // Zapier-friendly payload as a single JSON string
    const payload = JSON.stringify({ description, photoUrl, location });

    // Row shape that matches your historical columns
    const row = [
      ts(),            // A Timestamp (yyyy-mm-dd HH:MM:SS)
      teamCode,        // B Team Code
      activity,        // C Activity
      nonce,           // D Nonce (unique per submission)
      payload,         // E Payload (JSON)
      'QUEUED',        // F AI Status (initial state)
      0,               // G AI Attempts
      '',              // H AI Score
      '',              // I Final Score
      idempotencyKey,  // J Idempotency
      eventId          // K Event Id
    ];

    await appendRowZapierShape(sheets, spreadsheetId, row);
    return ok({ success:true, message:'Submitted' });
  } catch (err) {
    console.error('Kindness submission error:', err);
    return bad(400, err.message || 'Submission failed');
  }
};
