exports.handler = async () => ({
  statusCode: 200,
  body: JSON.stringify({
    CONTEXT: process.env.CONTEXT, // production / deploy-preview / branch-deploy
    // what your function can actually see at runtime:
    GOOGLE_SERVICE_EMAIL: !!process.env.GOOGLE_SERVICE_EMAIL,
    GOOGLE_PRIVATE_KEY_BUILD: !!process.env.GOOGLE_PRIVATE_KEY_BUILD,
    GOOGLE_PRIVATE_KEY: !!process.env.GOOGLE_PRIVATE_KEY,
    GOOGLE_SERVICE_ACCOUNT_JSON_B64: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64,
    GOOGLE_SHEET_ID: !!process.env.GOOGLE_SHEET_ID,
    TEAMS_SHEET_ID: !!process.env.TEAMS_SHEET_ID,
    TEAMS_SHEET_NAME: process.env.TEAMS_SHEET_NAME || '(unset)'
  }, null, 2)
});
