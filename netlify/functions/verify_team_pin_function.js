// /.netlify/functions/verify_team_pin_function.js
// Sign-in via team dropdown + PIN. Reuses your _utils.js so it matches env exactly.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ok  = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c, m) => ({ statusCode: c, headers: CORS, body: JSON.stringify({ success: false, message: m }) });

// ---------- Try to use your shared utils first ----------
let U = null;
try { U = require('./_utils'); } catch (e) { /* not fatal */ }

function getSpreadsheetId() {
  return (
    (U && (U.SPREADSHEET_ID || U.SHEET_ID || U.spreadsheetId)) ||
    process.env.GOOGLE_SHEET_ID ||
    process.env.SPREADSHEET_ID ||
    process.env.SHEET_ID ||
    ''
  );
}

async function getSheetsClientFlex() {
  // Preferred: your utils (whatever they export)
  if (U) {
    if (typeof U.getSheetsClient === 'function') return await U.getSheetsClient();
    if (typeof U.getSheets === 'function') {
      const s = await U.getSheets();
      // accept either {spreadsheets:{values:{get}}} or already-an-instance
      if (s?.spreadsheets?.values?.get) return s;
      if (s?.sheets?.spreadsheets?.values?.get) return s.sheets;
    }
    if (U.sheets?.spreadsheets?.values?.get) return U.sheets;
    if (U.google && U.auth && typeof U.google.sheets === 'function') {
      return U.google.sheets({ version: 'v4', auth: U.auth });
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
    process.env.GOOGLE_CREDENTIALS ||
    '';

  let sa = null;
  if (raw) {
    const text = raw.trim().startsWith('{')
      ? raw
      : Buffer.from(raw, 'base64').toString('utf8');
    sa = JSON.parse(text);
  } else {
    // (b) split email/key
    const email =
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
      process.env.GCP_SA_EMAIL ||
      process.env.GCLOUD_CLIENT_EMAIL ||
      process.env.SERVICE_ACCOUNT_EMAIL ||
      '';
    let private_key =
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
      process.env.GCP_SA_KEY ||
      process.env.GCLOUD_PRIVATE_KEY ||
      process.env.SERVICE_ACCOUNT_PRIVATE_KEY ||
      '';
    if (email && private_key) {
      private_key = private_key.replace(/\\n/g, '\n');
      sa = { client_email: email, private_key };
    }
  }

  if (!sa) {
    throw new Error(
      'Missing Google service account (set GOOGLE_SERVICE_ACCOUNT_JSON[_B64] or EMAIL/PRIVATE_KEY)'
    );
  }

  const auth = new google.auth.JWT(
    sa.client_email,
    null,
    sa.private_key,
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

async function readTeams() {
  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) throw new Error('Missing GOOGLE_SHEET_ID / SPREADSHEET_ID');

  const sheets = await getSheetsClientFlex();

  const ranges = ['teams!A:Z', 'Teams!A:Z', 'TEAMS!A:Z'];
  let rows = [];
  let lastErr;
  for (const range of ranges) {
    try {
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
      rows = resp.data.values || [];
      if (rows.length) break;
    } catch (e) { lastErr = e; }
  }
  if (!rows.length) {
    if (lastErr) throw lastErr;
    throw new Error('No rows found in Teams sheet');
  }

  const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
  const findIdx = (...names) => names.map(n => headers.indexOf(n)).find(i => i >= 0);

  const idxCode = findIdx('teamcode','code','team_code','id');
  const idxName = findIdx('teamname','name','team_name');
  const idxPin  = findIdx('pin','secret','passcode');

  if (idxCode == null || idxCode < 0 || idxPin == null || idxPin < 0) {
    throw new Error('Teams sheet must include columns for teamCode and pin');
  }

  return rows.slice(1)
    .map(r => ({
      teamCode: (r[idxCode] || '').toString().trim(),
      teamName: idxName >= 0 ? (r[idxName] || '').toString().trim() : '',
      pin:      (r[idxPin]  || '').toString().trim(),
    }))
    .filter(t => t.teamCode);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({ success: true });
  if (event.httpMethod !== 'POST') return bad(405, 'Use POST');

  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch { return bad(400, 'Invalid JSON'); }

  const { eventId, teamCode, pin } = body || {};
  if (!eventId || !teamCode || !pin) return bad(400, 'eventId, teamCode, pin are required');

  try {
    const teams = await readTeams();
    const t = teams.find(x => x.teamCode === teamCode);
    if (!t) return ok({ success: true, valid: false });

    const valid = String(t.pin) === String(pin).trim();
    if (!valid) return ok({ success: true, valid: false });

    return ok({ success: true, valid: true, teamName: t.teamName });
    // If you mint JWTs elsewhere, you can also include: token
  } catch (err) {
    console.error('verify_team_pin_function error:', err);
    return bad(500, err.message || 'Server error');
  }
};
