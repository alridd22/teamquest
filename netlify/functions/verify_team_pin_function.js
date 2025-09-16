// /.netlify/functions/verify_team_pin_function.js
// --- same as your latest working version, but now it also MINTS a team JWT on success ---

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ok  = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c, m) => ({ statusCode: c, headers: CORS, body: JSON.stringify({ success:false, message:m }) });

// Try to use your shared utils first
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
  // Fallback: direct googleapis with broad env support
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

// ——— Flexible Teams reader (accepts many header variants) ———
const norm = (s='') => String(s).toLowerCase().replace(/[^a-z0-9]+/g,'');
const findIdx = (hdrs, names) => {
  const H = hdrs.map(norm);
  for (const n of names) { const i = H.indexOf(norm(n)); if (i >= 0) return i; }
  return -1;
};
async function readTeams() {
  const id = spreadsheetId();
  if (!id) throw new Error('Missing GOOGLE_SHEET_ID / SPREADSHEET_ID');
  const sheets = await getSheets();
  const ranges = ['teams!A:Z','Teams!A:Z','TEAMS!A:Z'];
  let rows = [];
  for (const r of ranges) {
    try { const resp = await sheets.spreadsheets.values.get({ spreadsheetId:id, range:r });
      rows = resp.data.values || []; if (rows.length) break;
    } catch {}
  }
  if (!rows.length) throw new Error('No rows found in Teams sheet');
  const headers = rows[0];
  const idxCode = findIdx(headers, ['teamcode','code','team_code','id','team id','team id']);
  const idxPin  = findIdx(headers, ['pin','passcode','secret','password','access code','team pin']);
  const idxName = findIdx(headers, ['teamname','name','team_name']);
  if (idxCode < 0 || idxPin < 0) throw new Error('Teams sheet must include columns for teamCode and pin');
  return rows.slice(1).map(r => ({
    teamCode: (r[idxCode]||'').toString().trim(),
    teamName: idxName>=0 ? (r[idxName]||'').toString().trim() : '',
    pin:      (r[idxPin] ||'').toString().trim(),
  })).filter(t => t.teamCode);
}

// ——— Try to mint a JWT using utils; fall back to jsonwebtoken ———
async function makeTeamToken({ eventId, teamCode }) {
  // Utilities you might already expose
  if (U) {
    if (typeof U.issueTeamToken === 'function')  return await U.issueTeamToken({ eventId, teamCode });
    if (typeof U.signTeamJWT   === 'function')   return await U.signTeamJWT({ eventId, teamCode });
    if (typeof U.signJwt       === 'function')   return U.signJwt({ eventId, teamCode, role:'team' });
    if (typeof U.makeJwt       === 'function')   return U.makeJwt({ eventId, teamCode, role:'team' });
  }
  // Fallback: jsonwebtoken
  try {
    const jwt = require('jsonwebtoken');
    const secret = process.env.TQ_TEAM_JWT_SECRET || process.env.JWT_SECRET || process.env.SECRET;
    if (!secret) return null;
    return jwt.sign({ eventId, teamCode, role:'team' }, secret, { expiresIn:'12h' });
  } catch {
    return null; // jsonwebtoken not installed
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({ success:true });
  if (event.httpMethod !== 'POST')   return bad(405,'Use POST');

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return bad(400,'Invalid JSON'); }

  const { eventId, teamCode, pin } = body || {};
  if (!eventId || !teamCode || !pin) return bad(400,'eventId, teamCode, pin are required');

  try {
    const teams = await readTeams();
    const t = teams.find(x => x.teamCode === String(teamCode).trim());
    if (!t) return ok({ success:true, valid:false });

    const valid = String(t.pin) === String(pin).trim();
    if (!valid) return ok({ success:true, valid:false });

    // NEW: return a token if we can mint one
    const token = await makeTeamToken({ eventId, teamCode });
    return ok({ success:true, valid:true, teamName: t.teamName, ...(token ? { token } : {}) });
  } catch (err) {
    console.error('verify_team_pin_function error:', err);
    return bad(500, err.message || 'Server error');
  }
};
