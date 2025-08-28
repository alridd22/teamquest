// ESM version – no `require` anywhere
import fs from "node:fs";
import path from "node:path";

const outPath = process.env.GOOGLE_KEY_FILE || "netlify/functions/sa_key.pem";

// Collect any env that could contain a key (JSON or PEM or base64)
let src =
  process.env.GOOGLE_PRIVATE_KEY_BUILD ||
  process.env.GOOGLE_PRIVATE_KEY ||
  process.env.GOOGLE_PRIVATE_KEY_B64 ||
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
  process.env.GOOGLE_CREDENTIALS_JSON ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
  "";

function looksBase64(s) {
  return /^[A-Za-z0-9+/=\s]+$/.test(s) && !s.includes("{") && !s.includes("-----BEGIN");
}
function tryBase64Decode(s) {
  try { return Buffer.from(s.trim(), "base64").toString("utf8"); } catch { return null; }
}
function unescapeNewlines(s) { return s.replace(/\\n/g, "\n"); }

try {
  if (!src) {
    console.log("[write-sa-key] No GOOGLE_* key env found. Skipping file write.");
    process.exit(0);
  }

  const maybeDecoded = looksBase64(src) ? tryBase64Decode(src) : null;
  if (maybeDecoded) src = maybeDecoded;

  let pem = "";

  // If it's JSON, pull private_key; otherwise treat as PEM (maybe with \n escapes)
  if (src.trim().startsWith("{")) {
    try {
      const obj = JSON.parse(src);
      if (obj.private_key) pem = unescapeNewlines(obj.private_key);
    } catch { /* ignore */ }
  } else {
    pem = unescapeNewlines(src);
  }

  if (!pem.includes("BEGIN PRIVATE KEY")) {
    console.log("[write-sa-key] Could not extract a valid PEM from envs. Skipping.");
    process.exit(0); // non-fatal – don’t fail the build
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, pem, "utf8");
  console.log(`[write-sa-key] Wrote ${outPath} (${Buffer.byteLength(pem)} bytes).`);
  process.exit(0);
} catch (e) {
  console.log("[write-sa-key] Error (non-fatal):", e.message);
  process.exit(0); // keep non-fatal so deploys aren’t blocked by key creation
}
