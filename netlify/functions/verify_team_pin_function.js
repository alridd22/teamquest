// /.netlify/functions/verify_team_pin_function.js
const { google } = require('googleapis');

// ---- CORS helpers ----
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ok  = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c, m) => ({ statusCode: c, headers: CORS, body: JSON.stringify({ success: false, message: m }) });

// ---- ENV: spreadsheet + service account ----
const SPREADSHEET_ID =
  process.env.GOOGLE_SHEET_ID ||
  process.env.SPREADSHEET_ID ||
  process.env.SHEET_ID ||
  '';

function parseServiceAccount() {
  let raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GCP_SERVICE_ACCOUNT ||
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    '';
  if (!raw) return null;
  if (!raw.trim().startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(raw);
}

async function getSheets() {
  const svc = parseServiceAccount();
  if (!svc) throw new Error('Missing Google service account JSON (set GOOGLE_SERVICE_ACCOUNT_JSON or *_B64)');
  const auth = new google.auth.JWT(
    svc.client_email,
    null,
    svc.private_key,
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

// ---- Handler ----
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({ success: true });
  if (event.httpMethod !== 'POST') return bad(405, 'Use POST');

  // Parse body safely
  let body = {};
  try { body = JSON.parse(event.body || '{}'); }
  catch { return bad(400, 'Invalid JSON'); }

  const { eventId, teamCode, pin } = body || {};
  if (!eventId || !teamCode || !pin) return bad(400, 'eventId, teamCode, pin are required');
  if (!SPREADSHEET_ID) return bad(500, 'Missing GOOGLE_SHEET_ID / SPREADSHEET_ID env');

  try {
    const sheets = await getSheets();
    // Read the Teams tab (headers in row 1). Adjust tab name if yours differs.
    const range = 'teams!A:Z';
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
    const rows = resp.data.values || [];
    if (!rows.length) return bad(500, 'No data in teams sheet');

    const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
    const idxCode = headers.indexOf('teamcode') >= 0 ? headers.indexOf('teamcode') : headers.indexOf('code');
    const idxName = headers.indexOf('teamname') >= 0 ? headers.indexOf('teamname') : headers.indexOf('name');
    const idxPin  = headers.indexOf('pin') >= 0 ? headers.indexOf('pin') : headers.indexOf('secret');

    if (idxCode < 0 || idxPin < 0) return bad(500, 'Teams sheet must include columns: teamCode, pin');

    const row = rows.slice(1).find(r => (r[idxCode] || '').trim() === teamCode);
    if (!row) return ok({ success: true, valid: false });

    const valid = String(row[idxPin] || '').trim() === String(pin).trim();
    if (!valid) return ok({ success: true, valid: false });

    const teamName = idxName >= 0 ? String(row[idxName] || '').trim() : '';

    // If you issue JWTs elsewhere, you can also include { token: jwt }
    return ok({ success: true, valid: true, teamName });
  } catch (err) {
    console.error('verify_team_pin_function error:', err);
    return bad(500, err.message || 'Server error');
  }
};
