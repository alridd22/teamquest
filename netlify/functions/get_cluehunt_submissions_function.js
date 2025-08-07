const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
  console.log('Get clue hunt submissions request started');

  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
      body: '',
    };
  }

  try {
    // Parse request body
    const requestBody = JSON.parse(event.body);
    const { teamCode } = requestBody;

    if (!teamCode) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        body: JSON.stringify({
          success: false,
          error: 'Team code is required'
        }),
      };
    }

    // Get environment variables
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const privateKeyBase64 = process.env.GOOGLE_PRIVATE_KEY_B64;

    if (!serviceAccountEmail || !privateKeyBase64 || !sheetId) {
      throw new Error('Missing required environment variables');
    }

    // Decode private key
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
    console.log('Sheet loaded successfully:', doc.title);

    // Get clue hunt submissions for this team
    const submissions = [];
    let totalScore = 0;
    
    try {
      const clueHuntSheet = doc.sheetsByTitle['Clue Hunt'];
      if (clueHuntSheet) {
        await clueHuntSheet.loadHeaderRow();
        const rows = await clueHuntSheet.getRows();
        console.log('Clue Hunt rows loaded:', rows.length);

        // Filter rows for this team
        const teamRows = rows.filter(row => row.get('Team Code') === teamCode);
        console.log(`Found ${teamRows.length} clue attempts for team ${teamCode}`);

        teamRows.forEach(row => {
          const clueId = parseInt(row.get('Clue ID'));
          const userAnswer = row.get('User Answer');
          const correctAnswer = row.get('Correct Answer');
          const points = parseInt(row.get('Points')) || 0;
          const wasCorrect = row.get('Was Correct') === 'true' || row.get('Was Correct') === true;
          const attemptTime = row.get('Timestamp');

          if (clueId) {
            submissions.push({
              clueId: clueId,
              userAnswer: userAnswer,
              correctAnswer: correctAnswer,
              points: points,
              wasCorrect: wasCorrect,
              attemptTime: attemptTime
            });

            // Add to total score if correct
            if (wasCorrect && points > 0) {
              totalScore += points;
            }
          }
        });
      }
    } catch (error) {
      console.log('Error loading clue hunt sheet:', error.message);
    }

    console.log(`Team ${teamCode} - Total clue attempts: ${submissions.length}, Total score: ${totalScore}`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
      body: JSON.stringify({
        success: true,
        submissions: submissions,
        totalScore: totalScore,
        teamCode: teamCode,
        timestamp: Date.now()
      }),
    };

  } catch (error) {
    console.error('Get clue hunt submissions error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        timestamp: Date.now()
      }),
    };
  }
};