// /.netlify/functions/verify_team_pin_function.js
const { google } = require('googleapis');

// ---------- CORS ----------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ok  = (b) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(b) });
const bad = (c, m) => ({ statusCode: c, headers: CORS, body: JSON.stringify({ success: false, message: m }) });

// ---------- ENV: spreadsheet id (use your standard keys) ----------
const SPREADSHEET_ID =
  process.env.GOOGLE_SHEET_ID ||
  process.env.SPREADSHEET_ID ||
  process.env.SHEET_ID ||
  '';

// ---------- Service Account parsing (supports JSON or split email/key) ----------
function buildServiceAccount() {
  // 1) Full JSON, possibly base64
  let raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.GCP_SERVICE_ACCOUNT ||
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    '';
  if (raw) {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    try { return JSON.parse(text); } catch (e) { /* fall through to split */ }
  }

  // 2) Split env (email + private key)
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
    // Netlify often stores \n as literal two chars; fix them
    private_key = private_key.replace(/\\n/g, '\n');
    return { client_email: email, private_key };
  }

  return null;
}

async function getSheetsClient() {
  const sa = buildServiceAccount();
  if (!sa) throw new Error('Missing Google service account (set GOOGLE_SERVICE_ACCOUNT_JSON[_B64] or EMAIL/PRIVATE_KEY)');
  const auth = new google.auth.JWT(
    sa.client_email,
    null,
    sa.private_key,
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

// ---------- Helper to read the Teams sheet robustly ----------
async function readTeams() {
  const sheets = await getSheetsClient();

  // Try common tab names
  const ranges = ['teams!A:Z', 'Teams!A:Z', 'TEAMS!A:Z'];
  let rows = [];
  let lastErr;
  for (const range of ranges) {
    try {
      const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
      rows = resp.data.values || [];
      if (rows.length) break;
    } catch (e) { lastErr = e; }
  }
  if (!rows.length) {
    if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID / SPREADSHEET_ID');
    if (lastErr) throw lastErr;
    throw new Error('No rows found in teams sheet');
  }

  const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
  const getIdx = (...names) => names.map(n => headers.indexOf(n)).find(i => i >= 0);
  const idxCode = getIdx('teamcode', 'code', 'team_code', 'id');
  const idxName = getIdx('teamname', 'name', 'team_name');
  const idxPin  = getIdx('pin', 'secret', 'passcode');

  if (idxCode == null || idxCode < 0 || idxPin == null || idxPin < 0) {
    throw new Error('Teams sheet must include columns for teamCode and pin');
  }

  const teams = rows.slice(1).map(r => ({
    teamCode: (r[idxCode] || '').toString().trim(),
    teamName: idxName >= 0 ? (r[idxName] || '').toString().trim() : '',
    pin:      (r[idxPin]  || '').toString().trim(),
  })).filter(t => t.teamCode);

  return teams;
}

// ---------- Handler ----------
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({ success: true });
  if (event.httpMethod !== 'POST') return bad(405, 'Use POST');

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return bad(400, 'Invalid JSON'); }

  const { eventId, teamCode, pin } = body || {};
  if (!eventId || !teamCode || !pin) return bad(400, 'eventId, teamCode, pin are required');

  try {
    const teams = await readTeams();
    const t = teams.find(x => x.teamCode === teamCode);
    if (!t) return ok({ success: true, valid: false });

    const valid = String(t.pin) === String(pin).trim();
    if (!valid) return ok({ success: true, valid: false });

    // If you issue JWTs elsewhere, you can attach it here: { token }
    return ok({ success: true, valid: true, teamName: t.teamName });
  } catch (err) {
    console.error('verify_team_pin_function error:', err);
    return bad(500, err.message || 'Server error');
  }
};
