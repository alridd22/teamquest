// scripts/write-sa-key.js
// Writes the GOOGLE_PRIVATE_KEY env var to netlify/functions/sa_key.pem at build time.
const fs = require('fs');
const path = require('path');

const key = process.env.GOOGLE_PRIVATE_KEY;
if (!key) {
  console.log('No GOOGLE_PRIVATE_KEY found at build time; skipping file write.');
  process.exit(0);
}

const normalized = key.replace(/\\n/g, '\n');
const outDir = path.join(process.cwd(), 'netlify', 'functions');
const outPath = path.join(outDir, 'sa_key.pem');

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, normalized, { encoding: 'utf8' });
console.log('Wrote service account key to', outPath);
