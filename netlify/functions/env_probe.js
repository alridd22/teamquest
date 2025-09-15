exports.handler = async () => {
  const keys = Object.keys(process.env)
    .filter(k => /(GOOGLE|SHEET|SPREADSHEET|ADMIN|TQ_)/i.test(k))
    .sort();

  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      has_GOOGLE_SERVICE_ACCOUNT_JSON_B64: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64,
      len_GOOGLE_SERVICE_ACCOUNT_JSON_B64: (process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 || '').length,
      has_GOOGLE_SERVICE_ACCOUNT_JSON: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
      has_GCP_SERVICE_ACCOUNT: !!process.env.GCP_SERVICE_ACCOUNT,
      has_FIREBASE_SERVICE_ACCOUNT: !!process.env.FIREBASE_SERVICE_ACCOUNT,
      SPREADSHEET_ID: !!(process.env.GOOGLE_SHEET_ID || process.env.SPREADSHEET_ID),
      admin_keys_seen: keys.filter(k => /(ADMIN|TQ_.*SECRET)/i.test(k)),
      ALL_MATCHING_KEYS: keys,
    }, null, 2),
  };
};
