// /.netlify/functions/verify_team_pin_function.js
// Flexible verify: accepts many header variants and falls back to row scanning.
// Works with your hardened env via _utils.js when available.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ok  = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c, m) => ({ statusCode: c, headers: CORS, body: JSON.stringify({ success:false, message:m }) });

// Try to use your shared utils first (same env/auth as other funcs)
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
  // Prefer utils wiring
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
  // (a) full JSON (raw or base64)
  let raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GCP_SERVICE_ACCOUNT ||
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    process.env.GOOGLE_CREDENTIALS_B64 ||
    process.env.GOOGLE_CREDENTIALS || '';
  let sa = null;
  if (raw) {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    sa = JSON.parse(text);
  } else {
    // (b) split email/key
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
  if (!sa) throw new Error('Missing Google service account (set GOOGLE_SERVICE_ACCOUNT_JSON[_B64] or EMAIL/PRIVATE_KEY)');

  const auth = new google.auth.JWT(sa.client_email, null, sa.private_key, [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
  ]);
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

// ---------- header helpers ----------
const normalize = (h='') => String(h).toLowerCase().replace(/[^a-z0-9]+/g, '');
const CODE_HEADERS = new Set([
  'teamcode','code','team_code','teamid','team_id','id','crewcode','crewid','crew_id','crewcode',
].map(normalize));
const PIN_HEADERS  = new Set([
  'pin','teampin','team_pin','passcode','pass_code','secret','password','accesscode','access_code','crewpin',
].map(normalize));

function findIndex(headers, candidates) {
  for (let i=0;i<headers.length;i++) {
    const h = normalize(headers[i]);
    if (candidates.has(h)) return i;
    if (h.includes('code') && candidates===CODE_HEADERS) return i;
    if ((h.includes('pin') || h.includes('pass')) && candidates===PIN_HEADERS) return i;
  }
  return -1;
}

function looksLikePin(v) {
  const s = String(v || '').trim();
  return /^\d{3,6}$/.test(s) || /^[A-Za-z0-9]{3,8}$/.test(s);
}
function looksLikeCode(v) {
  const s = String(v || '').trim();
  return s.length >= 3 && /[A-Za-z]/.test(s);
}

// ---------- read Teams tab with flexible detection ----------
async function readTeams() {
  const id = spreadsheetId();
  if (!id) throw new Error('Missing GOOGLE_SHEET_ID / SPREADSHEET_ID');

  const sheets = await getSheets();
  const ranges = ['teams!A:Z', 'Teams!A:Z', 'TEAMS!A:Z'];
  let rows = [];
  let lastErr;
  for (const range of ranges) {
    try {
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId: id, range });
      rows = resp.data.values || [];
      if (rows.length) break;
    } catch (e) { lastErr = e; }
  }
  if (!rows.length) {
    if (lastErr) throw lastErr;
    throw new Error('No rows found in Teams sheet');
  }

  const headers = rows[0];
  let idxCode = findIndex(headers, CODE_HEADERS);
  let idxPin  = findIndex(headers, PIN_HEADERS);
  let idxName = findIndex(headers, new Set(['teamname','name','team_name'].map(normalize)));

  // Fall back: infer by scanning rows if headers unknown
  if (idxCode < 0 || idxPin < 0) {
    const body = rows.slice(1);
    // guess code = first column that matches many "code-like" cells
    if (idxCode < 0) {
      const counts = headers.map((_,i)=>0);
      body.forEach(r => { if (looksLikeCode(r[i])) counts[i]++; });
      idxCode = counts.indexOf(Math.max(...counts));
    }
    if (idxPin < 0) {
      const counts = headers.map((_,i)=>0);
      body.forEach(r => { if (looksLikePin(r[i])) counts[i]++; });
      idxPin = counts.indexOf(Math.max(...counts));
    }
  }

  if (idxCode < 0 || idxPin < 0) {
    throw new Error('Teams sheet must include columns for teamCode and pin');
  }

  return {
    headers,
    rows: rows.slice(1).map(r => ({
      teamCode: (r[idxCode] || '').toString().trim(),
      teamName: idxName >= 0 ? (r[idxName] || '').toString().trim() : '',
      pin:      (r[idxPin]  || '').toString().trim(),
      _row: r
    }))
  };
}

// ---------- handler ----------
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({ success:true });
  if (event.httpMethod !== 'POST')   return bad(405,'Use POST');

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return bad(400,'Invalid JSON'); }

  const { eventId, teamCode, pin } = body || {};
  if (!eventId || !teamCode || !pin) return bad(400,'eventId, teamCode, pin are required');

  try {
    const { rows } = await readTeams();
    const row = rows.find(r => r.teamCode === String(teamCode).trim());
    if (!row) return ok({ success:true, valid:false });

    const valid = String(row.pin) === String(pin).trim();
    if (!valid) return ok({ success:true, valid:false });

    return ok({ success:true, valid:true, teamName: row.teamName });
  } catch (err) {
    console.error('verify_team_pin_function error:', err);
    return bad(500, err.message || 'Server error');
  }
};
