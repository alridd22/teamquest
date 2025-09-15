// /netlify/functions/admin_start_event.js

const { google } = require('googleapis');

// ---------- Config ----------
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Env: service account (base64 JSON), sheet id, admin keys
function getServiceAccount() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 || '';
  if (!b64) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON_B64');
  // Accept both pure JSON and base64-encoded JSON
  try {
    const asStr = Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(asStr);
  } catch {
    return JSON.parse(b64);
  }
}
const SPREADSHEET_ID =
  process.env.GOOGLE_SHEET_ID ||
  process.env.SPREADSHEET_ID ||
  '';

function unauthorized(message = 'Unauthorized') {
  return {
    statusCode: 401,
    headers: CORS_HEADERS,
    body: JSON.stringify({ success: false, message }),
  };
}
function bad(statusCode, message) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify({ success: false, message }) };
}
function ok(body) {
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

// ---------- Helpers ----------
function getAdminToken(event) {
  const q = event.queryStringParameters || {};
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  if (q.key) return q.key.trim();
  return null;
}
function isAllowedAdmin(token) {
  const list =
    (process.env.ADMIN_API_KEYS || process.env.ADMIN_TOKEN || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  if (list.length === 0) return false; // Hardened default: require at least one key
  return !!token && list.includes(token);
}
function colLetter(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function getSheetsClient() {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID / SPREADSHEET_ID');
  const sa = getServiceAccount();
  const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
  const jwt = new google.auth.JWT(sa.client_email, undefined, sa.private_key, scopes);
  await jwt.authorize();
  return google.sheets({ version: 'v4', auth: jwt });
}

async function readHeaders(sheets, sheetName) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!1:1`,
  });
  const headers = r.data.values?.[0] || [];
  const index = Object.fromEntries(headers.map((h, i) => [h, i]));
  return { headers, index };
}

async function findEventRow(sheets, sheetName, eventId) {
  // Read whole sheet (small data set) – first row are headers
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
  });
  const rows = r.data.values || [];
  if (rows.length < 2) return { rowIndex: null, rowObj: null, headers: rows[0] || [] };

  const headers = rows[0];
  const idxByHeader = Object.fromEntries(headers.map((h, i) => [h, i]));
  const idCol = idxByHeader['Event Id'] ?? 0;

  for (let i = 1; i < rows.length; i++) {
    const vals = rows[i];
    if ((vals[idCol] || '').toString().trim() === eventId) {
      const rowIndex = i + 1; // 1-based including header row
      const rowObj = Object.fromEntries(headers.map((h, col) => [h, vals[col] ?? '']));
      return { rowIndex, rowObj, headers };
    }
  }
  return { rowIndex: null, rowObj: null, headers };
}

async function updateRowPatch(sheets, sheetName, rowIndex, headers, patch) {
  const lastCol = colLetter(headers.length || 10);
  // Read existing row so we can patch by header name
  const read = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A${rowIndex}:${lastCol}${rowIndex}`,
  });
  const rowVals = read.data.values?.[0] || new Array(headers.length).fill('');
  const pos = Object.fromEntries(headers.map((h, i) => [h, i]));
  for (const [k, v] of Object.entries(patch)) {
    if (pos[k] != null) rowVals[pos[k]] = v;
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A${rowIndex}:${lastCol}${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [rowVals] },
  });
}

// ---------- Handler ----------
exports.handler = async (event) => {
  try {
    // CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: CORS_HEADERS, body: '' };
    }
    if (event.httpMethod !== 'POST') {
      return bad(405, 'Method not allowed. Use POST.');
    }

    // Admin auth
    const adminToken = getAdminToken(event);
    if (!isAllowedAdmin(adminToken)) return unauthorized();

    // Parse body
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return bad(400, 'Invalid JSON body');
    }
    const eventId = (body.eventId || body.id || '').toString().trim();
    if (!eventId) return bad(400, 'Missing eventId');
    const actionIn = (body.action || 'start').toString().trim().toLowerCase();
    const action = actionIn === 'stop' ? 'end' : actionIn;

    const sheetName = 'events';
    const sheets = await getSheetsClient();

    // Locate row
    const { rowIndex, rowObj, headers } = await findEventRow(sheets, sheetName, eventId);
    if (!rowIndex || !rowObj) return bad(404, `Event not found: ${eventId}`);

    const now = new Date();
    const nowIso = now.toISOString();
    const durationSec = Number(rowObj.DurationSec || rowObj['DurationSec'] || 0);

    // Update helpers
    const setRunning = async () => {
      const startedAtIso = nowIso;
      const endsAtIso = new Date(now.getTime() + durationSec * 1000).toISOString();
      await updateRowPatch(sheets, sheetName, rowIndex, headers, {
        'State': 'RUNNING',
        'StartedAt (ISO)': startedAtIso,
        'EndsAt (ISO)': endsAtIso,
        'UpdatedAt (ISO)': nowIso,
      });
      return { success: true, eventId, state: 'RUNNING', startedAt: startedAtIso, endsAt: endsAtIso, durationSec };
    };

    const setPaused = async () => {
      await updateRowPatch(sheets, sheetName, rowIndex, headers, {
        'State': 'PAUSED',
        'UpdatedAt (ISO)': nowIso,
      });
      return { success: true, eventId, state: 'PAUSED' };
    };

    const setEnded = async () => {
      await updateRowPatch(sheets, sheetName, rowIndex, headers, {
        'State': 'ENDED',
        'UpdatedAt (ISO)': nowIso,
      });
      return { success: true, eventId, state: 'ENDED' };
    };

    const setReset = async () => {
      await updateRowPatch(sheets, sheetName, rowIndex, headers, {
        'State': 'NOT_STARTED',
        'StartedAt (ISO)': '',
        'EndsAt (ISO)': '',
        'UpdatedAt (ISO)': nowIso,
      });
      return { success: true, eventId, state: 'NOT_STARTED' };
    };

    // Execute
    let result;
    switch (action) {
      case 'start':
        result = await setRunning();
        break;
      case 'pause':
        result = await setPaused();
        break;
      case 'end':
        result = await setEnded();
        break;
      case 'reset':
        result = await setReset();
        break;
      default:
        return bad(400, `Unknown action: ${actionIn}`);
    }

    return ok(result);
  } catch (err) {
    console.error('admin_start_event error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, message: err.message || 'Server error' }),
    };
  }
};

