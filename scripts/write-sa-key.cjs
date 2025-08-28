// scripts/write-sa-key.cjs
// Writes netlify/functions/sa_key.json at build time from GOOGLE_SERVICE_ACCOUNT_JSON_B64
const fs = require("node:fs");
const path = require("node:path");

const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64; // BUILD-scope env var
if (!b64) {
  console.log("[write-sa-key] GOOGLE_SERVICE_ACCOUNT_JSON_B64 not set (build env). Skipping.");
  process.exit(0);
}

let jsonText;
try {
  jsonText = Buffer.from(b64.trim(), "base64").toString("utf8");
  const obj = JSON.parse(jsonText); // sanity check
  if (!obj.client_email || !obj.private_key) {
    console.error("[write-sa-key] JSON present but missing client_email/private_key.");
    process.exit(1);
  }
} catch (e) {
  console.error("[write-sa-key] Invalid Base64 or JSON:", e.message);
  process.exit(1);
}

const outDir = path.join(__dirname, "..", "netlify", "functions");
const outPath = path.join(outDir, "sa_key.json");

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, jsonText, { encoding: "utf8", mode: 0o600 });
console.log("[write-sa-key] Wrote", outPath, `(${Buffer.byteLength(jsonText)} bytes)`);
