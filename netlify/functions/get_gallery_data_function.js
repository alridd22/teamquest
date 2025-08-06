const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
  console.log('Gallery data request started');

  // Handle CORS
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
    const { type } = JSON.parse(event.body);
    
    if (!type || !['kindness', 'limerick'].includes(type)) {
      throw new Error('Invalid or missing type parameter');
    }

    console.log('Loading gallery data for type:', type);

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

    let submissions = [];

    if (type === 'kindness') {
      // Load Kindness submissions
      try {
        const kindnessSheet = doc.sheetsByTitle['Kindness'];
        if (kindnessSheet) {
          await kindnessSheet.loadHeaderRow();
          const rows = await kindnessSheet.getRows();
          console.log('Kindness rows loaded:', rows.length);

          submissions = rows.map(row => ({
            teamCode: row.get('Team Code'),
            teamName: row.get('Team Name'),
            description: row.get('Description'),
            photoUrl: row.get('Photo Status'), // Your photos are in the Photo Status column
            aiScore: row.get('AI Score'),
            verified: row.get('Verified'),
            submissionTime: row.get('Submission Time')
          })).filter(item => 
            item.teamCode && 
            item.teamName && 
            item.description && 
            item.photoUrl &&
            item.submissionTime &&
            item.photoUrl.startsWith('https://') // Only include entries with valid photo URLs
          );

          // Sort by submission time (newest first)
          submissions.sort((a, b) => new Date(b.submissionTime) - new Date(a.submissionTime));
        }
      } catch (error) {
        console.log('Kindness sheet not found or error:', error.message);
      }

    } else if (type === 'limerick') {
      // Load Limerick submissions
      try {
        const limerickSheet = doc.sheetsByTitle['Limerick'];
        if (limerickSheet) {
          await limerickSheet.loadHeaderRow();
          const rows = await limerickSheet.getRows();
          console.log('Limerick rows loaded:', rows.length);

          submissions = rows.map(row => ({
            teamCode: row.get('Team Code'),
            teamName: row.get('Team Name'),
            topic: row.get('Topic'),
            limerickText: row.get('Limerick Text'),
            rhymePattern: row.get('Rhyme Pattern'),
            aiScore: row.get('AI Score'),
            verified: row.get('Verified'),
            submissionTime: row.get('Submission Time')
          })).filter(item => 
            item.teamCode && 
            item.teamName && 
            item.topic && 
            item.limerickText &&
            item.submissionTime
          );

          // Sort by submission time (newest first)
          submissions.sort((a, b) => new Date(b.submissionTime) - new Date(a.submissionTime));
        }
      } catch (error) {
        console.log('Limerick sheet not found or error:', error.message);
      }
    }

    console.log('Gallery data loaded:', {
      type,
      submissionCount: submissions.length
    });

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        type,
        submissions,
        count: submissions.length,
        lastUpdated: new Date().toISOString()
      }),
    };

  } catch (error) {
    console.error('Gallery data error:', error);
    
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
