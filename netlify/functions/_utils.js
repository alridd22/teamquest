// _utils.js  (expanded)
import { google } from "googleapis";

/* ===== Env mapping ===== */
export const SHEET_ID =
  process.env.SHEET_ID || process.env.GOOGLE_SHEET_ID;
const GOOGLE_CLIENT_EMAIL =
  process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_EMAIL;
const GOOGLE_PRIVATE_KEY = (
  process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY_BUILD || ""
).replace(/\\n/g, "\n");
const ADMIN_SECRET = process.env.TQ_ADMIN_SECRET;
export const JWT_SECRET =
  process.env.JWT_SECRET || process.env.TQ_JWT_SECRET;
export const CURRENT_EVENT_ID = process.env.TQ_CURRENT_EVENT_ID || ""; // optional

/* ===== HTTP helpers ===== */
export function ok(body, extraHeaders = {}) {
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
export function error(statusCode, message, extra = {}) {
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
export const isPreflight = (e) => e.httpMethod === "OPTIONS";
export function requireAdmin(event) {
  const s = event.headers["x-admin-secret"] || event.headers["X-Admin-Secret"];
  if (!s || s !== ADMIN_SECRET) throw new Error("Forbidden: bad admin secret");
}

/* ===== Sheets client (memoized) ===== */
let _sheets;
export async function getSheets() {
  if (_sheets) return _sheets;
  const auth = new google.auth.JWT(
    GOOGLE_CLIENT_EMAIL,
    null,
    GOOGLE_PRIVATE_KEY,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );
  _sheets = google.sheets({ version: "v4", auth });
  return _sheets;
}

/* ===== Utility ===== */
export function nowIso() { return new Date().toISOString(); }
export function indexByHeader(values) {
  const header = (values && values[0]) || [];
  const rows = values ? values.slice(1) : [];
  const idx = header.reduce((m, h, i) => (m[h] = i, m), {});
  return { header, rows, idx };
}

/* ===== A1 helpers ===== */
export function tabRange(tab, a1) {
  // Optional event scoping: Teams_[EVENT]!A:E, etc.
  const t = CURRENT_EVENT_ID ? `${tab}_${CURRENT_EVENT_ID}` : tab;
  return `${t}!${a1}`;
}

/* ===== Retry wrapper ===== */
async function withRetry(fn, attempts = 3, baseDelay = 200) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) { last = e; }
    await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, i)));
  }
  throw last;
}

/* ===== Read / Write / Append ===== */
export async function readRange(sheets, spreadsheetId, range) {
  const id = spreadsheetId || SHEET_ID;
  return withRetry(async () => {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: id, range });
    return r.data.values || [];
  });
}
export async function writeRange(sheets, spreadsheetId, range, values) {
  const id = spreadsheetId || SHEET_ID;
  return withRetry(async () => sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range,
    valueInputOption: "RAW",
    requestBody: { values },
  }));
}
export async function appendRows(sheets, spreadsheetId, range, values) {
  const id = spreadsheetId || SHEET_ID;
  return withRetry(async () => sheets.spreadsheets.values.append({
    spreadsheetId: id,
    range,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  }));
}

/* ===== State helpers (State!A:B) ===== */
export async function getStateMap(sheets) {
  const vals = await readRange(sheets, SHEET_ID, tabRange("State", "A:B"));
  const map = {};
  (vals.slice(1) || []).forEach(([k, v]) => (map[k] = v));
  return map;
}
export async function setStateKV(sheets, key, value) {
  // Read state to find row for key; append if missing
  const vals = await readRange(sheets, SHEET_ID, tabRange("State", "A:B"));
  const header = vals[0] || ["Key","Value"];
  let found = false;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][0] === key) {
      await writeRange(sheets, SHEET_ID, tabRange("State", `A${i+1}:B${i+1}`), [[key, String(value)]]);
      found = true; break;
    }
  }
  if (!found) {
    await appendRows(sheets, SHEET_ID, tabRange("State", "A1"), [[key, String(value)]]);
  }
}

/* ===== Simple lock (best-effort, per-key) =====
   Uses State! with keys: lock:<name> = ownerId|expiresIso
*/
export async function withLock(sheets, name, fn, ttlMs = 8000) {
  const lockKey = `lock:${name}`;
  const owner = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const now = Date.now();
  const expires = new Date(now + ttlMs).toISOString();

  // Try to acquire
  const state = await getStateMap(sheets);
  const current = state[lockKey];
  if (current) {
    const [, exp] = String(current).split("|");
    if (exp && new Date(exp).getTime() > now) {
      throw new Error(`Lock busy: ${name}`);
    }
  }
  await setStateKV(sheets, lockKey, `${owner}|${expires}`);

  try {
    const res = await fn();
    return res;
  } finally {
    // Release if still owner
    const state2 = await getStateMap(sheets);
    const val = state2[lockKey];
    if (val && val.startsWith(owner)) {
      // set expired
      await setStateKV(sheets, lockKey, `${owner}|${new Date(Date.now()-1).toISOString()}`);
    }
  }
}
