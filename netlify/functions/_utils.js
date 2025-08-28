// netlify/functions/_utils.js
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
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Admin-Secret",
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
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Admin-Secret",
    },
    body: JSON.stringify({ error: message, ...extra }),
  };
}

const isPreflight = (e) => e.httpMethod === "OPTIONS";

function requireAdmin(event) {
  const s = event.headers["x-admin-secret"] || event.headers["X-Admin-Secret"];
  if (!s || s !== ADMIN_SECRET) throw new Error("Forbidden: bad admin secret");
}

/* ===== Sheets client (memoized) — JSON keyfile written at build ===== */
let _sheets;

async function getSheets() {
  if (_sheets) return _sheets;

  const path = require("node:path");
  const { GoogleAuth } = require("google-auth-library");

  // Written by scripts/write-sa-key.cjs during build
  const keyFile = path.join(__dirname, "sa_key.json");

  const auth = new GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const client = await auth.getClient();
  _sheets = google.sheets({ version: "v4", auth: client });
  return _sheets;
}

/* ===== Sheet helpers ===== */
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
