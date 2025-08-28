// scripts/write-sa-key.cjs
const fs = require("node:fs");
const path = require("node:path");

const outPath = process.env.GOOGLE_KEY_FILE || "netlify/functions/sa_key.pem";

let src =
  process.env.GOOGLE_PRIVATE_KEY_BUILD ||
  process.env.GOOGLE_PRIVATE_KEY ||
  process.env.GOOGLE_PRIVATE_KEY_B64 ||
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
  process.env.GOOGLE_CREDENTIALS_JSON ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
  "";

// If GOOGLE_APPLICATION_CREDENTIALS is a path to a JSON, prefer that.
const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;

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

function loadCandidate() {
  // 1) If GOOGLE_APPLICATION_CREDENTIALS points to a file, try to read it
  if (gac && fs.existsSync(gac)) {
    try {
      const text = fs.readFileSync(gac, "utf8");
      return { text, source: `file:${gac}` };
    } catch {}
  }

  // 2) If src was not populated but there’s a JSON-pointer env that looks like a path, try it
  if (!src) {
    const maybePath =
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      process.env.GOOGLE_CREDENTIALS_JSON ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
      "";
    if (maybePath && fs.existsSync(maybePath)) {
      try {
        const text = fs.readFileSync(maybePath, "utf8");
        return { text, source: `file:${maybePath}` };
      } catch {}
    }
  }

  // 3) Otherwise use src directly (env content)
  if (!src) return null;
  const decoded = looksBase64(src) ? tryBase64Decode(src) : null;
  return { text: decoded || src, source: "env" };
}

try {
  const cand = loadCandidate();
  if (!cand) {
    console.log("[write-sa-key] No GOOGLE_* key env/file found. Skipping.");
    process.exit(0);
  }

  let pem = "";
  const raw = cand.text.trim();

  if (raw.startsWith("{")) {
    // JSON -> extract private_key
    try {
      const obj = JSON.parse(raw);
      if (obj.private_key) pem = unescapeNewlines(obj.private_key);
    } catch {}
  } else {
    pem = unescapeNewlines(raw);
  }

  if (!pem.includes("BEGIN PRIVATE KEY")) {
    console.log("[write-sa-key] Could not extract a valid PEM from", cand.source, "Skipping.");
    process.exit(0);
  }

  // Ensure target directory and write with tight perms
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, pem, { encoding: "utf8", mode: 0o600 });

  console.log(`[write-sa-key] Wrote ${outPath} (${Buffer.byteLength(pem)} bytes) from ${cand.source}.`);
  process.exit(0);
} catch (e) {
  console.log("[write-sa-key] Error (non-fatal):", e.message);
  process.exit(0);
}
