const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_EMAIL = process.env.GOOGLE_SERVICE_EMAIL;
const SERVICE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\n/g, '\n');
const JWT_SECRET = process.env.TQ_JWT_SECRET;
const CURRENT_EVENT = process.env.TQ_CURRENT_EVENT_ID || 'default';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache',
  'Expires': '0',
};
const ok  = (body={}) => ({ statusCode: 200, headers: corsHeaders, body: JSON.stringify(body) });
const bad = (code, message, extra={}) => ({ statusCode: code, headers: corsHeaders, body: JSON.stringify({ success:false, message, ...extra }) });

function signToken(payload, ttlSeconds=4*60*60) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ttlSeconds });
}
function verifyToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) throw new Error('Missing token');
  return jwt.verify(authHeader.slice(7), JWT_SECRET);
}
function nowIso(){ return new Date().toISOString(); }
function toNum(v,d=0){ return (v===''||v==null) ? d : (Number(v)||d); }

async function getDoc() {
  const auth = new JWT({ email: SERVICE_EMAIL, key: SERVICE_KEY, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const doc = new GoogleSpreadsheet(SHEET_ID, auth);
  await doc.loadInfo();
  return doc;
}
async function getOrCreateSheet(doc, title, headers) {
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) sheet = await doc.addSheet({ title, headerValues: headers });
  await sheet.loadHeaderRow();
  if (!sheet.headerValues?.length) await sheet.setHeaderRow(headers);
  return sheet;
}
// Append-once using an Idempotency hash column
async function appendOnce(sheet, idempotencyKey, rowData) {
  const hash = crypto.createHash('sha256').update(idempotencyKey).digest('hex');
  let found = [];
  try { found = await sheet.getRows({ limit: 1, query: `Idempotency = "${hash}"` }); } catch (_e) { /* ignore */ }
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
