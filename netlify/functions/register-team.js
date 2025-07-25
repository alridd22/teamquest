const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
  console.log('Function started');

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
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    console.log('Parsing request body');
    const { teamCode, teamName, teamPin } = JSON.parse(event.body);
    console.log('Team data received:', { teamCode, teamName, teamPin: teamPin ? '****' : undefined });

    // Get environment variables
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

    // Decode private key from base64
    console.log('Decoding GOOGLE_PRIVATE_KEY_B64');
    let privateKey = Buffer.from(privateKeyBase64, 'base64').toString('utf8');

    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      throw new Error('Private key format invalid – missing BEGIN header');
    }

    console.log('Private key successfully decoded, length:', privateKey.length);

    // Create JWT client
    console.log('Creating JWT client');
    const serviceAccountAuth = new JWT({
      email: serviceAccountEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    // Initialize Google Sheet
    console.log('Initializing Google Sheet');
    const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);

    try {
      await doc.loadInfo();
      console.log('Sheet loaded successfully:', doc.title);
    } catch (loadError) {
      console.error('Sheet load failed:', loadError.message);
      throw new Error(`Sheet access failed: ${loadError.message}`);
    }

    const sheet = doc.sheetsByIndex[0];
    console.log('Using sheet:', sheet.title);

    await sheet.loadHeaderRow();

    if (!sheet.headerValues || sheet.headerValues.length === 0) {
      console.log('Setting up headers');
      await sheet.setHeaderRow(['Team Code', 'Team Name', 'Team PIN', 'Registration Time']);
    }

    console.log('Adding team data to sheet');
    const newRow = await sheet.addRow({
      'Team Code': teamCode,
      'Team Name': teamName,
      'Team PIN': teamPin,
      'Registration Time': new Date().toISOString(),
    });

    console.log('Team registered successfully:', newRow.rowNumber);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        message: 'Team registered successfully',
        teamCode,
        teamName,
      }),
    };

  } catch (error) {
    console.error('Registration error:', error);

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
