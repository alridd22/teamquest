const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
  console.log('Get scavenger submissions request started');

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

    // Get submissions for this team from Scavenger sheet
    const submissions = [];
    
    try {
      const scavengerSheet = doc.sheetsByTitle['Scavenger'];
      if (scavengerSheet) {
        await scavengerSheet.loadHeaderRow();
        const rows = await scavengerSheet.getRows();
        console.log('Scavenger rows loaded:', rows.length);

        // Filter rows for this team
        const teamRows = rows.filter(row => row.get('Team Code') === teamCode);
        console.log(`Found ${teamRows.length} submissions for team ${teamCode}`);

        teamRows.forEach(row => {
          const itemId = row.get('Item ID');
          const aiScore = parseInt(row.get('AI Score')) || 0;
          const verified = row.get('Verified');
          const submissionTime = row.get('Submission Time');
          
          // Consider it submitted if there's an AI Score OR if Verified column has any value
          const isSubmitted = aiScore > 0 || (verified && verified !== 'Pending AI Verification');
          const isVerified = verified === 'Verified' && aiScore > 0;

          if (itemId) {
            submissions.push({
              itemId: itemId,
              score: aiScore,
              verified: isVerified,
              submitted: isSubmitted,
              submissionTime: submissionTime,
              verifiedStatus: verified
            });
          }
        });
      }
    } catch (error) {
      console.log('Error loading scavenger sheet:', error.message);
    }

    console.log('Returning submissions:', submissions);

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
        teamCode: teamCode,
        timestamp: Date.now()
      }),
    };

  } catch (error) {
    console.error('Get scavenger submissions error:', error);
    
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