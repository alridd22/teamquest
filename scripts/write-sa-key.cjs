const fs = require("node:fs");
const path = require("node:path");

const outPath = process.env.GOOGLE_KEY_FILE || "netlify/functions/sa_key.pem";

let src =
  process.env.GOOGLE_PRIVATE_KEY_BUILD ||
  process.env.GOOGLE_PRIVATE_KEY ||
  process.env.GOOGLE_PRIVATE_KEY_B64 ||
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
  process.env.GOOGLE_CREDENTIALS_JSON ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "";

function looksBase64(s) {
  return /^[A-Za-z0-9+/=\s]+$/.test(s) && !s.includes("{") && !s.includes("-----BEGIN");
}
function tryBase64Decode(s) {
  try { return Buffer.from(s.trim(), "base64").toString("utf8"); } catch { return null; }
}
function unescapeNewlines(s) { return s.replace(/\\n/g, "\n"); }

try {
  if (!src) {
    console.log("[write-sa-key] No GOOGLE_* key env found. Skipping.");
    process.exit(0);
  }
  const maybe = looksBase64(src) ? tryBase64Decode(src) : null;
  if (maybe) src = maybe;

  let pem = "";
  if (src.trim().startsWith("{")) {
    try {
      const obj = JSON.parse(src);
      if (obj.private_key) pem = unescapeNewlines(obj.private_key);
    } catch {}
  } else {
    pem = unescapeNewlines(src);
  }

  if (!pem.includes("BEGIN PRIVATE KEY")) {
    console.log("[write-sa-key] Could not extract a valid PEM. Skipping.");
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, pem, "utf8");
  console.log(`[write-sa-key] Wrote ${outPath} (${Buffer.byteLength(pem)} bytes).`);
  process.exit(0);
} catch (e) {
  console.log("[write-sa-key] Error (non-fatal):", e.message);
  process.exit(0);
}
