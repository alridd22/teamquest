// /.netlify/functions/submit_kindness_function.js
// Accepts Kindness submissions with optional JWT. Falls back to teamCode-only.
// Writes to "submissions" (or "Submissions") with a tidy row.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ok  = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c, m) => ({ statusCode: c, headers: CORS, body: JSON.stringify({ success:false, message:m }) });

// Try to reuse your hardened utils (env, auth, sheets)
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
  // Prefer utils wiring if present
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
  // Fallback: direct googleapis (supports JSON or split email/key)
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
  if (!authz.startsWith('Bearer ')) return null;
  const token = authz.slice(7).trim();

  // Prefer your utils’ verifier if available
  if (U) {
    try {
      if (typeof U.verifyTeamToken === 'function') return await U.verifyTeamToken(token);
      if (typeof U.verifyJwt === 'function') return await U.verifyJwt(token);
    } catch { /* ignore */ }
  }
  // Fallback: jsonwebtoken with any of these secrets
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

// Load teams and confirm a code exists
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
    } catch { /* try next */ }
  }
  return false;
}

// Read all existing submissions to prevent duplicates (best-effort)
async function hasExistingSubmission(sheets, spreadsheetId, eventId, teamCode) {
  const ranges = ['submissions!A:Z','Submissions!A:Z'];
  for (const range of ranges) {
    try {
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
      const rows = resp.data.values || [];
      if (!rows.length) continue;
      const headers = rows[0];
      const idxEvent = findIdx(headers, ['eventid','event','event_id']);
      const idxTeam  = findIdx(headers, ['teamcode','team','team_code','code','crew','crewcode']);
      const idxType  = findIdx(headers, ['type','activity']);
      const body = rows.slice(1);
      return body.some(r =>
        (idxEvent < 0 || (r[idxEvent] || '').toString().trim() === eventId) &&
        (idxTeam  < 0 || (r[idxTeam]  || '').toString().trim() === teamCode) &&
        (idxType  < 0 || norm(r[idxType] || '') === 'kindness')
      );
    } catch { /* try next */ }
  }
  return false;
}

// Append submission (first tab that works)
async function appendSubmission(sheets, spreadsheetId, row) {
  const targets = ['submissions!A:Z','Submissions!A:Z','Kindness!A:Z','KINDNESS!A:Z'];
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
    } catch { /* try next */ }
  }
  throw new Error('Could not append to any submissions sheet (tried: submissions, Submissions, Kindness)');
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({ success:true });
  if (event.httpMethod !== 'POST')   return bad(405,'Use POST');

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return bad(400,'Invalid JSON'); }

  const eventId = (body.eventId || body.event || '').toString().trim();
  let teamCode  = (body.teamCode || body.team || '').toString().trim();

  // Pull from JWT if present (preferred)
  const claims = await getTeamFromAuth(event);
  if (claims?.teamCode) teamCode = claims.teamCode;

  // Map/normalize payload fields
  const description = (body.description || body.text || body.story || body.storyText || body.desc || '').toString().trim();
  const location    = (body.location || body.place || body.where || '').toString().trim();
  const photoUrl    = (body.photoUrl || body.imageUrl || body.imgUrl || body.url || body.photo || '').toString().trim();
  const teamName    = (body.teamName || '').toString().trim();

  if (!eventId) return bad(400,'Missing eventId');
  if (!teamCode) return bad(400,'Missing teamCode (sign in first)');
  if (!description || description.length < 5) return bad(400,'Please include a short description');
  if (!photoUrl) return bad(400,'Please include a photoUrl (Uploadcare URL)');

  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) return bad(500,'Missing GOOGLE_SHEET_ID / SPREADSHEET_ID');

  try {
    // optional: block if event is not running (uses utils if available)
    if (U && typeof U.getEventState === 'function') {
      const state = await U.getEventState(eventId).catch(()=>null);
      if (state && state !== 'RUNNING') {
        return bad(400, `Event state is ${state}; submissions are closed`);
      }
    }

    const sheets = await getSheets();

    // If no JWT, at least confirm the team code exists
    if (!claims?.teamCode) {
      const exists = await teamExists(sheets, spreadsheetId, teamCode);
      if (!exists) return bad(401,'Unknown teamCode');
    }

    // Enforce one kindness submission per team/event (best-effort)
    const already = await hasExistingSubmission(sheets, spreadsheetId, eventId, teamCode);
    if (already) return bad(400,'You already submitted a kindness for this event');

    // Compose a tidy row
    const timestamp = new Date().toISOString();
    const row = [
      timestamp,          // 1. timestamp
      eventId,            // 2. eventId
      'kindness',         // 3. type/activity
      teamCode,           // 4. teamCode
      teamName,           // 5. teamName (may be empty)
      description,        // 6. description / story
      photoUrl,           // 7. photoUrl
      location,           // 8. location (optional)
    ];

    await appendSubmission(sheets, spreadsheetId, row);

    return ok({ success:true, message:'Submitted' });
  } catch (err) {
    console.error('Kindness submission error:', err);
    return bad(400, err.message || 'Submission failed');
  }
};

