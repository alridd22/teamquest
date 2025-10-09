// /.netlify/functions/verify_team_pin_function.js
// Same structure as yours + event scoping (if Event Id column exists) and tolerant matching.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ok  = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c, m) => ({ statusCode: c, headers: CORS, body: JSON.stringify({ success:false, message:m }) });

let U = null;
try { U = require('./_utils'); } catch {}

function spreadsheetId() {
  return (
    (U && (U.SPREADSHEET_ID || U.SHEET_ID || U.spreadsheetId)) ||
    process.env.GOOGLE_SHEET_ID ||
    process.env.SPREADSHEET_ID ||
    process.env.SHEET_ID ||
    ''
  );
}

async function getSheets() {
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
  const { google } = require('googleapis');
  let raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GCP_SA_JSON ||
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
    'https://www.googleapis.com/auth/spreadsheets.readonly',
  ]);
  await auth.authorize();
  return google.sheets({ version:'v4', auth });
}

const normKey = (s='') => String(s).toLowerCase().replace(/[^a-z0-9]+/g,'');
const findIdx = (hdrs, names) => {
  const H = hdrs.map(normKey);
  for (const n of names) { const i = H.indexOf(normKey(n)); if (i >= 0) return i; }
  return -1;
};

// Read Teams with optional Event Id column
async function readTeams() {
  const id = spreadsheetId();
  if (!id) throw new Error('Missing GOOGLE_SHEET_ID / SPREADSHEET_ID');
  const sheets = await getSheets();
  const ranges = ['teams!A:Z','Teams!A:Z','TEAMS!A:Z'];
  let rows = [];
  for (const r of ranges) {
    try {
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId:id, range:r });
      rows = resp.data.values || [];
      if (rows.length) break;
    } catch {}
  }
  if (!rows.length) throw new Error('No rows found in Teams sheet');

  const headers = rows[0];
  const idxCode  = findIdx(headers, ['team code','teamcode','code','team_code','id']);
  const idxPin   = findIdx(headers, ['pin','team pin','passcode','secret','password','access code']);
  const idxName  = findIdx(headers, ['team name','teamname','name','team_name']);
  const idxEvent = findIdx(headers, ['event id','eventid']);
  if (idxCode < 0 || idxPin < 0) throw new Error('Teams sheet must include columns for Team Code and PIN');

  return rows.slice(1).map(r => ({
    teamCode: (r[idxCode]||'').toString().trim(),
    teamName: idxName>=0 ? (r[idxName]||'').toString().trim() : '',
    pin:      (r[idxPin] ||'').toString().trim(),
    eventId:  idxEvent>=0 ? (r[idxEvent]||'').toString().trim() : '' // may be blank if column absent
  })).filter(t => t.teamCode);
}

// JWT mint (unchanged behaviour)
async function makeTeamToken({ eventId, teamCode }) {
  if (U) {
    if (typeof U.issueTeamToken === 'function')  return await U.issueTeamToken({ eventId, teamCode });
    if (typeof U.signTeamJWT   === 'function')   return await U.signTeamJWT({ eventId, teamCode });
    if (typeof U.signJwt       === 'function')   return U.signJwt({ eventId, teamCode, role:'team' });
    if (typeof U.makeJwt       === 'function')   return U.makeJwt({ eventId, teamCode, role:'team' });
  }
  try {
    const jwt = require('jsonwebtoken');
    const secret = process.env.TQ_TEAM_JWT_SECRET || process.env.JWT_SECRET || process.env.SECRET;
    if (!secret) return null;
    return jwt.sign({ eventId, teamCode, role:'team' }, secret, { expiresIn:'12h' });
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({ success:true });
  if (event.httpMethod !== 'POST')   return bad(405,'Use POST');

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return bad(400,'Invalid JSON'); }

  const rawEventId = (body.eventId || '').toString().trim();
  const rawTeamCode = (body.teamCode || '').toString().trim();
  const pin = (body.pin || '').toString().trim();
  if (!rawEventId || !rawTeamCode || !pin) return bad(400,'eventId, teamCode, pin are required');

  const wantedEvent = rawEventId.toUpperCase();
  const wantedCode  = rawTeamCode.toUpperCase();

  try {
    const teams = await readTeams();

    // Scope to event if the sheet provides one; otherwise allow any event
    const candidates = teams.filter(t => !t.eventId || t.eventId.toUpperCase() === wantedEvent);

    const t = candidates.find(x => x.teamCode.toUpperCase() === wantedCode);
    if (!t) return ok({ success:true, valid:false });

    const valid = t.pin === pin;
    if (!valid) return ok({ success:true, valid:false });

    const token = await makeTeamToken({ eventId: rawEventId, teamCode: rawTeamCode });
    return ok({ success:true, valid:true, teamName: t.teamName || rawTeamCode, ...(token ? { token } : {}) });
  } catch (err) {
    console.error('verify_team_pin_function error:', err);
    return bad(500, err.message || 'Server error');
  }
};
