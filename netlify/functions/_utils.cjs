const { google } = require("googleapis");

/* ===== Env mapping ===== */
const SHEET_ID = process.env.SHEET_ID || process.env.GOOGLE_SHEET_ID || "";
const ADMIN_SECRET = process.env.TQ_ADMIN_SECRET;
const JWT_SECRET = process.env.JWT_SECRET || process.env.TQ_JWT_SECRET || "";
const CURRENT_EVENT_ID = process.env.TQ_CURRENT_EVENT_ID || ""; // optional

/* ===== HTTP helpers ===== */
function ok(body, extraHeaders = {}) {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Secret",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}
function error(statusCode, message, extra = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Secret",
    },
    body: JSON.stringify({ error: message, ...extra }),
  };
}
const isPreflight = (e) => e.httpMethod === "OPTIONS";
function requireAdmin(event) {
  const s = event.headers["x-admin-secret"] || event.headers["X-Admin-Secret"];
  if (!s || s !== ADMIN_SECRET) throw new Error("Forbidden: bad admin secret");
}

/* ===== key helpers ===== */
function looksBase64(s) {
  return /^[A-Za-z0-9+/=\s]+$/.test(s) && !s.includes("{") && !s.includes("-----BEGIN");
}
function tryBase64Decode(s) {
  try {
    const out = Buffer.from(s.trim(), "base64").toString("utf8");
    if (out.includes("-----BEGIN") || out.trim().startsWith("{")) return out;
  } catch {}
  return null;
}
function unescapeNewlines(s) {
  return s.replace(/\\n/g, "\n");
}

const EXPLICIT_CLIENT_EMAIL =
  process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_EMAIL || "";

/* ===== Resolve credentials from env JSON ===== */
function fromJsonCandidate(raw, sourceName) {
  if (!raw) return null;
  let text = raw.trim();
  const b = looksBase64(text) ? tryBase64Decode(text) : null;
  if (b) text = b;

  try {
    const obj = JSON.parse(text);
    const clientEmail = obj.client_email || EXPLICIT_CLIENT_EMAIL;
    let privateKey = obj.private_key || obj.privateKey || "";
    if (privateKey) privateKey = unescapeNewlines(privateKey);

    if (clientEmail && privateKey.includes("BEGIN PRIVATE KEY")) {
      return { clientEmail, privateKey, source: `env:${sourceName}` };
    }
  } catch {}
  return null;
}

/* ===== Resolve from separate envs ===== */
function fromSeparateEnvs() {
  let pk =
    process.env.GOOGLE_PRIVATE_KEY ||
    process.env.GOOGLE_PRIVATE_KEY_BUILD ||
    process.env.GOOGLE_PRIVATE_KEY_B64 ||
    "";
  if (!pk) return null;

  if (looksBase64(pk)) {
    const decoded = tryBase64Decode(pk);
    if (decoded) pk = decoded;
  } else {
    pk = unescapeNewlines(pk);
  }

  const clientEmail = EXPLICIT_CLIENT_EMAIL;
  if (clientEmail && pk.includes("BEGIN PRIVATE KEY")) {
    return { clientEmail, privateKey: pk, source: "env:separate" };
  }
  return null;
}

/* ===== Resolve from filesystem ===== */
function fromFileSystem() {
  const fs = require("node:fs");
  const path = require("node:path");

  const candidates = [];
  if (process.env.GOOGLE_KEY_FILE) candidates.push(process.env.GOOGLE_KEY_FILE);
  try {
    candidates.push(path.join(__dirname, "sa_key.pem"));
  } catch {}
  candidates.push("netlify/functions/sa_key.pem");

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const pk = fs.readFileSync(p, "utf8");
        if (pk.includes("BEGIN PRIVATE KEY")) {
          const clientEmail = EXPLICIT_CLIENT_EMAIL;
          if (!clientEmail) continue;
          return { clientEmail, privateKey: pk, source: `file:${p}` };
        }
      }
    } catch {}
  }
  return null;
}

async function resolveServiceAccount() {
  const jsonFirst =
    fromJsonCandidate(process.env.GOOGLE_SERVICE_ACCOUNT_JSON, "service_account_json") ||
    fromJsonCandidate(process.env.GOOGLE_CREDENTIALS_JSON, "credentials_json") ||
    fromJsonCandidate(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON, "application_credentials_json");
  if (jsonFirst) return jsonFirst;

  const sep = fromSeparateEnvs();
  if (sep) return sep;

  const file = fromFileSystem();
  if (file) return file;

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const fs = require("node:fs");
    try {
      const text = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8");
      const obj = JSON.parse(text);
      const clientEmail = obj.client_email || EXPLICIT_CLIENT_EMAIL;
      const privateKey = unescapeNewlines(obj.private_key || "");
      if (clientEmail && privateKey.includes("BEGIN PRIVATE KEY")) {
        return { clientEmail, privateKey, source: `file:${process.env.GOOGLE_APPLICATION_CREDENTIALS}` };
      }
    } catch {}
  }

  throw new Error(
    "No service account credentials found. Tried env JSON (GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_CREDENTIALS_JSON / GOOGLE_APPLICATION_CREDENTIALS_JSON), " +
    "separate envs (GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY*), sidecar/file (GOOGLE_KEY_FILE, sa_key.pem), and GOOGLE_APPLICATION_CREDENTIALS path."
  );
}

/* ===== Sheets client (memoized) ===== */
let _sheets;
async function getSheets() {
  if (_sheets) return _sheets;
  const { clientEmail, privateKey, source } = await resolveServiceAccount();
  console.info(`[sheets] Using service account from: ${source}`);
  const auth = new google.auth.JWT(
    clientEmail,
    null,
    privateKey,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );
  _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

/* ===== Helpers you referenced elsewhere (stubs if you already had them) ===== */
function tabRange(tab, a1) {
  return `${tab}!${a1}`;
}
function indexByHeader(values) {
  const header = values[0] || [];
  const idx = {};
  header.forEach((h, i) => (idx[h] = i));
  return { idx, rows: values.slice(1) };
}
async function readRange(sheets, spreadsheetId, range) {
  const sid = spreadsheetId || SHEET_ID;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sid, range });
  return res.data.values || [];
}
async function writeRange(sheets, spreadsheetId, range, values) {
  const sid = spreadsheetId || SHEET_ID;
  await sheets.spreadsheets.values.update({
    spreadsheetId: sid,
    range,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}
async function appendRows(sheets, spreadsheetId, range, values) {
  const sid = spreadsheetId || SHEET_ID;
  await sheets.spreadsheets.values.append({
    spreadsheetId: sid,
    range,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

module.exports = {
  SHEET_ID,
  JWT_SECRET,
  CURRENT_EVENT_ID,
  ok,
  error,
  isPreflight,
  requireAdmin,
  getSheets,
  readRange,
  writeRange,
  appendRows,
  indexByHeader,
  tabRange,
};
