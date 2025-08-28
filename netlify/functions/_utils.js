// netlify/functions/_utils.js
import { google } from "googleapis";

// ===== Env mapping =====
export const SHEET_ID = process.env.SHEET_ID || process.env.GOOGLE_SHEET_ID || "";
const ADMIN_SECRET   = process.env.TQ_ADMIN_SECRET;
export const JWT_SECRET = process.env.JWT_SECRET || process.env.TQ_JWT_SECRET || "";
export const CURRENT_EVENT_ID = process.env.TQ_CURRENT_EVENT_ID || ""; // optional

// We *may* have this explicitly, otherwise we can pull from JSON later
const EXPLICIT_CLIENT_EMAIL =
  process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_EMAIL || "";

// ===== HTTP helpers =====
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

// ===== Private key resolution =====
function looksBase64(s) {
  return /^[A-Za-z0-9+/=\s]+$/.test(s) && !s.includes("{") && !s.includes("-----BEGIN");
}
function tryBase64Decode(s) {
  try {
    const out = Buffer.from(s.trim(), "base64").toString("utf8");
    // sanity: decoded must look like JSON or a PEM
    if (out.includes("-----BEGIN") || out.trim().startsWith("{")) return out;
  } catch {}
  return null;
}
function unescapeNewlines(s) {
  return s.replace(/\\n/g, "\n");
}

/**
 * Try to extract { clientEmail, privateKey, source } from a JSON string
 * (raw or base64). Returns null if not possible.
 */
function fromJsonCandidate(raw, sourceName) {
  if (!raw) return null;
  let text = raw.trim();
  const b = looksBase64(text) ? tryBase64Decode(text) : null;
  if (b) text = b;

  try {
    const obj = JSON.parse(text);
    const clientEmail = obj.client_email || EXPLICIT_CLIENT_EMAIL;
    let privateKey = obj.private_key || "";
    if (!privateKey && obj.privateKey) privateKey = obj.privateKey;
    if (privateKey) privateKey = unescapeNewlines(privateKey);

    if (clientEmail && privateKey && privateKey.includes("BEGIN PRIVATE KEY")) {
      return { clientEmail, privateKey, source: `env:${sourceName}` };
    }
  } catch {}
  return null;
}

/**
 * Try to extract from separate env vars.
 */
function fromSeparateEnvs() {
  let pk =
    process.env.GOOGLE_PRIVATE_KEY ||
    process.env.GOOGLE_PRIVATE_KEY_BUILD ||
    process.env.GOOGLE_PRIVATE_KEY_B64 ||
    "";
  if (!pk) return null;

  // If pk looks like base64, decode; else unescape \n
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

/**
 * Try to read from file system (GOOGLE_KEY_FILE, local sidecar, legacy path).
 */
async function fromFileSystem() {
  const pathMod = await import("node:path");
  const fs = await import("node:fs");

  const candidates = [];
  if (process.env.GOOGLE_KEY_FILE) candidates.push(process.env.GOOGLE_KEY_FILE);

  // sidecar next to the compiled function file
  // __dirname is preserved with Netlify’s esbuild bundler
  let sidecar;
  try {
    sidecar = pathMod.join(__dirname, "sa_key.pem");
    candidates.push(sidecar);
  } catch {}

  // legacy project path
  candidates.push("netlify/functions/sa_key.pem");

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const pk = fs.readFileSync(p, "utf8");
        if (pk.includes("BEGIN PRIVATE KEY")) {
          // we still need a client email; prefer explicit env
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
  // 1) Env JSONs
  const jsonFirst =
    fromJsonCandidate(process.env.GOOGLE_SERVICE_ACCOUNT_JSON, "service_account_json") ||
    fromJsonCandidate(process.env.GOOGLE_CREDENTIALS_JSON, "credentials_json") ||
    fromJsonCandidate(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON, "application_credentials_json");
  if (jsonFirst) return jsonFirst;

  // 2) Separate envs
  const sep = fromSeparateEnvs();
  if (sep) return sep;

  // 3) File system
  const file = await fromFileSystem();
  if (file) return file;

  // 4) GOOGLE_APPLICATION_CREDENTIALS path (if provided)
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const fs = await import("node:fs");
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

  // Nothing worked → detailed error
  throw new Error(
    "No service account credentials found. Searched env JSON (GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_CREDENTIALS_JSON / GOOGLE_APPLICATION_CREDENTIALS_JSON)," +
      " separate envs (GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY*), sidecar/file (GOOGLE_KEY_FILE, sa_key.pem), and GOOGLE_APPLICATION_CREDENTIALS path."
  );
}

// ===== Sheets client (memoized) =====
let _sheets;
export async function getSheets() {
  if (_sheets) return _sheets;

  const { clientEmail, privateKey, source } = await resolveServiceAccount();

  // Non-secret confirmation in logs
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
