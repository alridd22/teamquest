exports.handler = async (event, context) => {
  console.log('Limerick submission started');
  
  // Handle preflight CORS requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {'Access-Control-Allow-Origin': '*'},
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { teamCode, teamName, topic, limerickText } = JSON.parse(event.body);
    
    console.log('Processing limerick submission for team:', teamCode);

    if (!teamCode || !teamName || !limerickText) {
      throw new Error('Missing required fields');
    }

    const sheetId = process.env.GOOGLE_SHEET_ID;
    const apiKey = process.env.GOOGLE_API_KEY;

    if (!sheetId || !apiKey) {
      throw new Error('Missing environment variables');
    }

    // Check what environment variables are actually available
    console.log('=== ENVIRONMENT VARIABLES DIAGNOSTIC ===');
    console.log('GOOGLE_API_KEY exists:', !!process.env.GOOGLE_API_KEY);
    console.log('GOOGLE_SHEET_ID exists:', !!process.env.GOOGLE_SHEET_ID);
    console.log('GOOGLE_SERVICE_ACCOUNT_EMAIL exists:', !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
    console.log('GOOGLE_PRIVATE_KEY_B64 exists:', !!process.env.GOOGLE_PRIVATE_KEY_B64);
    
    // List all environment variables that start with GOOGLE
    const googleEnvVars = Object.keys(process.env).filter(key => key.startsWith('GOOGLE'));
    console.log('All GOOGLE environment variables:', googleEnvVars);
    console.log('=== END DIAGNOSTIC ===');

    // Log the submission data
    console.log('=== LIMERICK SUBMISSION DATA ===');
    console.log('Team Code:', teamCode);
    console.log('Team Name:', teamName);
    console.log('Topic:', topic || 'No topic specified');
    console.log('Limerick Text:', limerickText);
    console.log('Submission Time:', new Date().toISOString());
    console.log('=== END SUBMISSION DATA ===');
    
    // Since API key can't write to sheets, we'll return success but note the limitation
    console.log('Note: API key authentication cannot write to sheets. Consider adding service account variables.');
    
    // Simulate AI scoring for demo (normally done by Zapier + OpenAI)
    const simulatedScore = Math.floor(Math.random() * 30) + 20; // 20-50 points
    
    console.log('Limerick submission processed (logged only)');

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        message: 'Limerick submitted successfully',
        simulatedScore: simulatedScore,
        teamCode,
        teamName,
        note: 'Submission logged - sheet writing requires service account authentication'
      }),
    };

  } catch (error) {
    console.error('Limerick submission error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    };
  }
};
