const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

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
    console.log('Parsing request body');
    const { teamCode, teamName, topic, limerickText } = JSON.parse(event.body);
    
    console.log('Processing limerick submission for team:', teamCode);

    if (!teamCode || !teamName || !limerickText) {
      throw new Error('Missing required fields');
    }

    // Get environment variables (same as kindness function)
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const privateKeyBase64 = process.env.GOOGLE_PRIVATE_KEY_B64;

    console.log('Environment variables check:', {
      hasEmail: !!serviceAccountEmail,
      hasSheetId: !!sheetId,
      hasPrivateKeyB64: !!privateKeyBase64,
    });

    if (!serviceAccountEmail || !privateKeyBase64 || !sheetId) {
      throw new Error('Missing required environment variables');
    }

    // Decode private key from base64 (same as kindness function)
    console.log('Decoding GOOGLE_PRIVATE_KEY_B64');
    let privateKey = Buffer.from(privateKeyBase64, 'base64').toString('utf8');

    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      throw new Error('Private key format invalid – missing BEGIN header');
    }

    console.log('Private key successfully decoded, length:', privateKey.length);

    // Create JWT client (same as kindness function)
    console.log('Creating JWT client');
    const serviceAccountAuth = new JWT({
      email: serviceAccountEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    // Initialize Google Sheet (same as kindness function)
    console.log('Initializing Google Sheet');
    const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);

    try {
      await doc.loadInfo();
      console.log('Sheet loaded successfully:', doc.title);
    } catch (loadError) {
      console.error('Sheet load failed:', loadError.message);
      throw new Error(`Sheet access failed: ${loadError.message}`);
    }

    // Find the Limerick sheet
    console.log('Looking for Limerick sheet');
    let limerickSheet = null;
    
    // Try to find existing Limerick sheet
    for (const sheet of Object.values(doc.sheetsByTitle)) {
      if (sheet.title === 'Limerick') {
        limerickSheet = sheet;
        break;
      }
    }

    if (!limerickSheet) {
      console.log('Limerick sheet not found, creating it');
      limerickSheet = await doc.addSheet({ 
        title: 'Limerick',
        headerValues: ['Team Code', 'Team Name', 'Topic', 'Limerick Text', 'Submission Time', 'AI Score']
      });
    } else {
      console.log('Using existing Limerick sheet');
      await limerickSheet.loadHeaderRow();
      
      // Set headers if they don't exist
      if (!limerickSheet.headerValues || limerickSheet.headerValues.length === 0) {
        console.log('Setting up Limerick sheet headers');
        await limerickSheet.setHeaderRow(['Team Code', 'Team Name', 'Topic', 'Limerick Text', 'Submission Time', 'AI Score']);
      }
    }

    console.log('Adding limerick submission to sheet');
    const submissionTime = new Date().toISOString();
    const newRow = await limerickSheet.addRow({
      'Team Code': teamCode,
      'Team Name': teamName,
      'Topic': topic || 'No topic specified',
      'Limerick Text': limerickText,
      'Submission Time': submissionTime,
      'AI Score': 'Pending AI Score'
    });

    console.log('Limerick submission saved successfully:', newRow.rowNumber);
    console.log('AI scoring will be processed automatically via Google Sheets trigger');

    // Return success - AI scoring will happen automatically
    const estimatedScore = 'Will be scored by AI within 1-2 minutes';
    
    console.log('Limerick submission processed successfully');

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        message: 'Limerick submitted successfully! AI will score your submission within 1-2 minutes.',
        estimatedScore: estimatedScore,
        teamCode,
        teamName
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
