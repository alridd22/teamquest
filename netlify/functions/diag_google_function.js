// netlify/functions/diag_google_function.js
// Diagnostic: enumerate envs, detect key source, try auth, call Sheets API.

const { JWT } = require("google-auth-library");
const fs = require("node:fs");
const path = require("node:path");

const { ok, error, isPreflight } = require("./_utils.js");

module.exports.handler = async (event) => {
  try {
    if (isPreflight(event)) return ok({});

    const res = await runDiag();
    return ok(res);
  } catch (e) {
    return error(500, e.message || "Diagnostic failed");
  }
};

function looksBase64(s) {
  return /^[A-Za-z0-9+/=\s]+$/.test(s) && !s.includes("{") && !s.includes("-----BEGIN");
}
function tryBase64Decode(s) {
  try { return Buffer.from(s.trim(), "base64").toString("utf8"); } catch { return null; }
}
function unescapeNewlines(s) { return s.replace(/\\n/g, "\n"); }

async function runDiag() {
  const SHEET_ID =
    process.env.SHEET_ID ||
    process.env.GOOGLE_SHEET_ID ||
    "";
  const keyPathSidecar = path.join(__dirname, "sa_key.pem");
  const keyPathLegacy = "netlify/functions/sa_key.pem";
  const keyPathEnv = process.env.GOOGLE_KEY_FILE;

  const envSnapshot = {
    SHEET_ID: SHEET_ID || "(missing)",
    GOOGLE_CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL ? "present" : "absent",
    GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL ? "present" : "absent",
    GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? "present" : "absent",
    GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY ? "present" : "absent",
    GOOGLE_PRIVATE_KEY_BUILD: process.env.GOOGLE_PRIVATE_KEY_BUILD ? "present" : "absent",
    GOOGLE_PRIVATE_KEY_B64: process.env.GOOGLE_PRIVATE_KEY_B64 ? "present" : "absent",
    GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? "present" : "absent",
    GOOGLE_CREDENTIALS_JSON: process.env.GOOGLE_CREDENTIALS_JSON ? "present" : "absent",
    GOOGLE_APPLICATION_CREDENTIALS_JSON: process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ? "present" : "absent",
    GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS || "(absent)",
    GOOGLE_KEY_FILE: keyPathEnv || "(absent)",
    sidecar_sa_key_pem_exists: fs.existsSync(keyPathSidecar),
    legacy_sa_key_pem_exists: fs.existsSync(keyPathLegacy),
  };

  // Resolve client email (any of the common envs)
  const clientEmail =
    process.env.GOOGLE_CLIENT_EMAIL ||
    process.env.GOOGLE_SERVICE_EMAIL ||
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    "";

  // Try JSON envs
  let source = null;
  let privateKey = "";
  let pickedClient = clientEmail;

  function fromJson(raw, name) {
    if (!raw) return null;
    let text = raw.trim();
    if (looksBase64(text)) {
      const decoded = tryBase64Decode(text);
      if (decoded) text = decoded;
    }
    try {
      const obj = JSON.parse(text);
      const ce = obj.client_email || pickedClient;
      let pk = obj.private_key || obj.privateKey || "";
      if (pk) pk = unescapeNewlines(pk);
      if (ce && pk.includes("BEGIN PRIVATE KEY")) return { clientEmail: ce, privateKey: pk, source: `env:${name}` };
    } catch {}
    return null;
  }

  const jsonCandidate =
    fromJson(process.env.GOOGLE_SERVICE_ACCOUNT_JSON, "service_account_json") ||
    fromJson(process.env.GOOGLE_CREDENTIALS_JSON, "credentials_json") ||
    fromJson(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON, "application_credentials_json");

  if (jsonCandidate) {
    pickedClient = jsonCandidate.clientEmail;
    privateKey = jsonCandidate.privateKey;
    source = jsonCandidate.source;
  }

  // Separate envs
  if (!source) {
    let pk =
      process.env.GOOGLE_PRIVATE_KEY ||
      process.env.GOOGLE_PRIVATE_KEY_BUILD ||
      process.env.GOOGLE_PRIVATE_KEY_B64 ||
      "";
    if (pk) {
      if (looksBase64(pk)) {
        const decoded = tryBase64Decode(pk);
        if (decoded) pk = decoded;
      } else {
        pk = unescapeNewlines(pk);
      }
      if (pickedClient && pk.includes("BEGIN PRIVATE KEY")) {
        privateKey = pk;
        source = "env:separate";
      }
    }
  }

  // File system
  if (!source) {
    const candidates = [keyPathEnv, keyPathSidecar, keyPathLegacy].filter(Boolean);
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          const pk = fs.readFileSync(p, "utf8");
          if (pk.includes("BEGIN PRIVATE KEY") && pickedClient) {
            privateKey = pk;
            source = `file:${p}`;
            break;
          }
        }
      } catch {}
    }
  }

  // GOOGLE_APPLICATION_CREDENTIALS (path to JSON file)
  if (!source && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      const text = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8");
      const obj = JSON.parse(text);
      const ce = obj.client_email || pickedClient;
      const pk = unescapeNewlines(obj.private_key || "");
      if (ce && pk.includes("BEGIN PRIVATE KEY")) {
        pickedClient = ce;
        privateKey = pk;
        source = `file:${process.env.GOOGLE_APPLICATION_CREDENTIALS}`;
      }
    } catch {}
  }

  const prelim = {
    success: false,
    sheet_id_present: !!SHEET_ID,
    client_email_present: !!pickedClient,
    detected_source: source || "(none)",
    client_email: pickedClient || "(missing)",
    env: envSnapshot,
  };

  if (!SHEET_ID) {
    prelim.note = "Missing SHEET_ID/GOOGLE_SHEET_ID";
    return prelim;
  }
  if (!source) {
    prelim.note =
      "No usable credentials found in env or files. Check JSON vars, separate key vars, or sa_key.pem inclusion.";
    return prelim;
  }

  // Try to authorize and fetch sheet title
  const auth = new JWT({
    email: pickedClient,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  try {
    await auth.authorize();
    const { token } = await auth.getAccessToken();

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      SHEET_ID
    )}?fields=spreadsheetId,properties.title`;
    // Node 18 has global fetch in Netlify
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await r.text();
    const body = safeJson(text);

    return {
      ...prelim,
      success: r.ok,
      http_status: r.status,
      http_statusText: r.statusText,
      sheet_title: body?.properties?.title || null,
      access_token_snippet: String(token || "").slice(0, 16) + "...",
      body: body ?? { raw: text.slice(0, 200) + (text.length > 200 ? "…" : "") },
    };
  } catch (e) {
    return { ...prelim, token_error: e.message || String(e) };
  }
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}
