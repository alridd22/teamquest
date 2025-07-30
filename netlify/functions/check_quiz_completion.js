const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
  console.log('Quiz completion check started');
  
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
    console.log('Parsing quiz completion check request');
    const { teamCode } = JSON.parse(event.body);
    
    console.log('Checking quiz completion for team:', teamCode);

    if (!teamCode) {
      throw new Error('Missing team code');
    }

    // Get environment variables (same as working functions)
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const privateKeyBase64 = process.env.GOOGLE_PRIVATE_KEY_B64;

    if (!serviceAccountEmail || !privateKeyBase64 || !sheetId) {
      console.log('Missing environment variables, allowing quiz');
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          success: true,
          completed: false,
          message: 'Environment not configured, allowing quiz'
        }),
      };
    }

    // Decode private key from base64
    let privateKey = Buffer.from(privateKeyBase64, 'base64').toString('utf8');
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    // Create JWT client
    const serviceAccountAuth = new JWT({
      email: serviceAccountEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    // Initialize Google Sheet
    const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    await doc.loadInfo();
    console.log('Sheet loaded successfully');

    // Look for Quiz sheet
    let quizSheet = null;
    for (const sheet of Object.values(doc.sheetsByTitle)) {
      if (sheet.title === 'Quiz') {
        quizSheet = sheet;
        break;
      }
    }

    if (!quizSheet) {
      console.log('Quiz sheet not found, allowing quiz');
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          success: true,
          completed: false,
          message: 'Quiz sheet not found, allowing quiz'
        }),
      };
    }

    // Load sheet data
    await quizSheet.loadHeaderRow();
    const rows = await quizSheet.getRows();
    
    // Check if team has already completed quiz
    const existingSubmission = rows.find(row => 
      row.get('Team Code') === teamCode
    );

    const hasCompleted = !!existingSubmission;
    
    console.log('Quiz completion check result:', {
      teamCode,
      hasCompleted,
      existingScore: existingSubmission ? existingSubmission.get('Total Score') : 'N/A'
    });

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        completed: hasCompleted,
        teamCode,
        existingScore: existingSubmission ? existingSubmission.get('Total Score') : null,
        existingCorrect: existingSubmission ? existingSubmission.get('Questions Correct') : null,
        existingTotal: existingSubmission ? existingSubmission.get('Total Questions') : null,
        message: hasCompleted ? 'Team has already completed the quiz' : 'Team can take the quiz'
      }),
    };

  } catch (error) {
    console.error('Quiz completion check error:', error);
    
    // On error, allow quiz to proceed (fail-safe)
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        completed: false,
        message: 'Check failed, allowing quiz to proceed'
      }),
    };
  }
};