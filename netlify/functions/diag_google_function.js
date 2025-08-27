// netlify/functions/diag_google_function.js
// Diagnostic: checks env vars, key file, auth, and calls Sheets API directly
const { JWT } = require('google-auth-library');
const fs = require('fs');
const path = require('path');

exports.handler = async () => {
  try {
    const result = await runDiag();
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify(result, null, 2)
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({ success: false, error: String(e.message || e) })
    };
  }
};

async function runDiag() {
  const SHEET_ID = process.env.GOOGLE_SHEET_ID;
  const SERVICE_EMAIL = process.env.GOOGLE_SERVICE_EMAIL;
  const keyPath = path.join(__dirname, 'sa_key.pem');

  const details = {
    success: false,
    env: {
      GOOGLE_SHEET_ID: SHEET_ID || '(missing)',
      GOOGLE_SERVICE_EMAIL: SERVICE_EMAIL || '(missing)',
      PRIVATE_KEY_env: process.env.GOOGLE_PRIVATE_KEY ? 'present' : 'not present',
      PRIVATE_KEY_file: fs.existsSync(keyPath) ? 'found' : 'not found'
    }
  };

  if (!SHEET_ID || !SERVICE_EMAIL) {
    details.note = "Missing env vars; set GOOGLE_SHEET_ID and GOOGLE_SERVICE_EMAIL";
    return details;
  }

  // Load private key
  let key;
  try {
    key = process.env.GOOGLE_PRIVATE_KEY
      ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : fs.readFileSync(keyPath, 'utf8');
  } catch (e) {
    details.auth_error = 'Could not load private key: ' + e.message;
    return details;
  }

  // Build JWT client
  const auth = new JWT({
    email: SERVICE_EMAIL,
    key,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  });

  // Try authorizing
  try {
    await auth.authorize();
    const token = await auth.getAccessToken();
    details.access_token_snippet = String(token || '').slice(0, 20) + '...';
  } catch (e) {
    details.token_error = e.message || String(e);
    return details;
  }

  // Call Sheets API directly
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SHEET_ID)}?fields=spreadsheetId,properties.title`;
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${await auth.getAccessToken()}` } });
    const text = await r.text();
    details.http_status = r.status;
    details.http_statusText = r.statusText;
    try { details.body = JSON.parse(text); } catch (_) { details.body_text = text; }
    details.success = r.ok;
    return details;
  } catch (e) {
    details.fetch_error = e.message || String(e);
    return details;
  }
}
