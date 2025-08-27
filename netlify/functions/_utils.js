// netlify/functions/_utils.js
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ---- Env + constants ----
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_EMAIL = process.env.GOOGLE_SERVICE_EMAIL;
const JWT_SECRET = process.env.TQ_JWT_SECRET;
const CURRENT_EVENT = process.env.TQ_CURRENT_EVENT_ID || 'default';

if (!SHEET_ID) throw new Error('Missing env GOOGLE_SHEET_ID');
if (!SERVICE_EMAIL) throw new Error('Missing env GOOGLE_SERVICE_EMAIL');
if (!JWT_SECRET) throw new Error('Missing env TQ_JWT_SECRET');

// Load key: prefer env, else bundled file from build step
let SERVICE_KEY = process.env.GOOGLE_PRIVATE_KEY;
if (SERVICE_KEY) {
  SERVICE_KEY = SERVICE_KEY.replace(/\\n/g, '\n');
} else {
  const keyPath = process.env.GOOGLE_PRIVATE_KEY_PATH || path.join(__dirname, 'sa_key.pem');
  try {
    SERVICE_KEY = fs.readFileSync(keyPath, 'utf8');
  } catch (_err) {
    throw new Error('Missing GOOGLE_PRIVATE_KEY env and sa_key.pem file');
  }
}

// ---- helpers ----
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache',
  'Expires': '0',
};
const ok  = (body={}) => ({ statusCode: 200, headers: corsHeaders, body: JSON.stringify(body) });
const bad = (code, message, extra={}) =>
  ({ statusCode: code, headers: corsHeaders, body: JSON.stringify({ success:false, message, ...extra }) });

function signToken(payload, ttlSeconds=4*60*60) { return jwt.sign(payload, JWT_SECRET, { expiresIn: ttlSeconds }); }
function verifyToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) throw new Error('Missing token');
  return jwt.verify(authHeader.slice(7), JWT_SECRET);
}
function nowIso(){ return new Date().toISOString(); }
function toNum(v,d=0){ return (v===''||v==null) ? d : (Number(v)||d); }

// ---- Google Sheets (constructor auth; no top-level await) ----
async function getDoc() {
  const auth = new JWT({
    email: SERVICE_EMAIL,
    key: SERVICE_KEY,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  });

  const doc = new GoogleSpreadsheet(SHEET_ID, auth);
  try {
    await doc.loadInfo();
  } catch (e) {
    const code = e?.response?.status || e?.code || 'unknown';
    const details = e?.response?.data?.error?.message || e?.message || String(e);
    throw new Error(`Google API error - [${code}] ${details}`);
  }
  return doc;
}

async function getOrCreateSheet(doc, title, headers) {
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) sheet = await doc.addSheet({ title, headerValues: headers });
  await sheet.loadHeaderRow();
  if (!sheet.headerValues?.length) await sheet.setHeaderRow(headers);
  return sheet;
}

// Append-once with idempotency hash
async function appendOnce(sheet, idempotencyKey, rowData) {
  const hash = crypto.createHash('sha256').update(idempotencyKey).digest('hex');
  let found = [];
  try { found = await sheet.getRows({ limit: 1, query: `Idempotency = "${hash}"` }); } catch (_e) {}
  if (found?.length) return { existed: true, row: found[0] };
  const row = await sheet.addRow({ ...rowData, Idempotency: hash });
  return { existed: false, row };
}

module.exports = {
  corsHeaders, ok, bad,
  signToken, verifyToken,
  getDoc, getOrCreateSheet, appendOnce,
  nowIso, toNum, CURRENT_EVENT
};
