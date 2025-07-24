const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
  console.log('Kindness submission started');
  
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
    const { teamCode, teamName, description, location, photoData } = JSON.parse(event.body);
    
    console.log('Processing kindness submission for team:', teamCode);

    if (!teamCode || !teamName || !description || !photoData) {
      throw new Error('Missing required fields');
    }

    // Get environment variables (same as registration)
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

    // Decode private key from base64 (same as registration)
    console.log('Decoding GOOGLE_PRIVATE_KEY_B64');
    let privateKey = Buffer.from(privateKeyBase64, 'base64').toString('utf8');

    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      throw new Error('Private key format invalid – missing BEGIN header');
    }

    console.log('Private key successfully decoded, length:', privateKey.length);

    // Create JWT client (same as registration)
    console.log('Creating JWT client');
    const serviceAccountAuth = new JWT({
      email: serviceAccountEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    // Initialize Google Sheet (same as registration)
    console.log('Initializing Google Sheet');
    const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);

    try {
      await doc.loadInfo();
      console.log('Sheet loaded successfully:', doc.title);
    } catch (loadError) {
      console.error('Sheet load failed:', loadError.message);
      throw new Error(`Sheet access failed: ${loadError.message}`);
    }

    // Find the Kindness sheet
    console.log('Looking for Kindness sheet');
    let kindnessSheet = null;
    
    // Try to find existing Kindness sheet
    for (const sheet of Object.values(doc.sheetsByTitle)) {
      if (sheet.title === 'Kindness') {
        kindnessSheet = sheet;
        break;
      }
    }

    if (!kindnessSheet) {
      console.log('Kindness sheet not found, creating it');
      kindnessSheet = await doc.addSheet({ 
        title: 'Kindness',
        headerValues: ['Team Code', 'Team Name', 'Description', 'Location', 'Photo Status', 'Submission Time', 'AI Score']
      });
    } else {
      console.log('Using existing Kindness sheet');
      await kindnessSheet.loadHeaderRow();
      
      // Set headers if they don't exist
      if (!kindnessSheet.headerValues || kindnessSheet.headerValues.length === 0) {
        console.log('Setting up Kindness sheet headers');
        await kindnessSheet.setHeaderRow(['Team Code', 'Team Name', 'Description', 'Location', 'Photo Status', 'Submission Time', 'AI Score']);
      }
    }

    console.log('Adding kindness submission to sheet');
    const newRow = await kindnessSheet.addRow({
      'Team Code': teamCode,
      'Team Name': teamName,
      'Description': description,
      'Location': location || '',
      'Photo Status': 'Photo uploaded',
      'Submission Time': new Date().toISOString(),
      'AI Score': 'Pending AI Score'
    });

    console.log('Kindness submission saved successfully:', newRow.rowNumber);

    // Simulate AI scoring for demo (normally done by Zapier + OpenAI)
    const simulatedScore = Math.floor(Math.random() * 30) + 20; // 20-50 points
    
    console.log('Kindness submission processed successfully');

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        message: 'Kindness act submitted successfully',
        simulatedScore: simulatedScore,
        teamCode,
        teamName
      }),
    };

  } catch (error) {
    console.error('Kindness submission error:', error);
    
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
