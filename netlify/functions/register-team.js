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

    // Validation
    if (!teamCode || !teamName || !teamPin) {
      throw new Error('Missing required fields: teamCode, teamName, or teamPin');
    }

    // Validate PIN is exactly 4 digits
    if (!/^\d{4}$/.test(teamPin)) {
      throw new Error('PIN must be exactly 4 digits');
    }

    // Get environment variables
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const sheetId = process.env.GOOGLE_SHEET_ID;
    let privateKey = process.env.GOOGLE_PRIVATE_KEY;

    console.log('Environment variables check:', {
      hasEmail: !!serviceAccountEmail,
      hasSheetId: !!sheetId,
      hasPrivateKey: !!privateKey,
      privateKeyLength: privateKey ? privateKey.length : 0
    });

    if (!serviceAccountEmail || !privateKey || !sheetId) {
      throw new Error('Missing required environment variables');
    }

    // Handle different private key formats
    console.log('Processing private key');
    
    // If it's base64 encoded, decode it first
    if (!privateKey.includes('-----BEGIN')) {
      console.log('Decoding base64 private key');
      try {
        privateKey = Buffer.from(privateKey, 'base64').toString('utf8');
      } catch (e) {
        console.log('Base64 decode failed, treating as raw key');
      }
    }

    // Replace \\n with actual newlines if needed
    privateKey = privateKey.replace(/\\n/g, '\n');

    // Ensure proper formatting
    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      throw new Error('Private key format invalid - missing BEGIN header');
    }

    console.log('Private key processed, length:', privateKey.length);

    // Create JWT client with more explicit error handling
    console.log('Creating JWT client');
    let serviceAccountAuth;
    
    try {
      serviceAccountAuth = new JWT({
        email: serviceAccountEmail,
        key: privateKey,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
        ],
      });
      console.log('JWT client created successfully');
    } catch (jwtError) {
      console.error('JWT creation failed:', jwtError.message);
      throw new Error(`JWT creation failed: ${jwtError.message}`);
    }

    // Initialize the sheet Document
    console.log('Initializing Google Sheet');
    const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    
    try {
      await doc.loadInfo();
      console.log('Sheet loaded successfully:', doc.title);
    } catch (loadError) {
      console.error('Sheet load failed:', loadError.message);
      throw new Error(`Sheet access failed: ${loadError.message}`);
    }

    // Get the first sheet
    const sheet = doc.sheetsByIndex[0];
    console.log('Using sheet:', sheet.title);

    // Check if sheet has headers, if not add them
    await sheet.loadHeaderRow();
    
    if (!sheet.headerValues || sheet.headerValues.length === 0) {
      console.log('Setting up headers with PIN column');
      await sheet.setHeaderRow(['Team Code', 'Team Name', 'Team PIN', 'Registration Time']);
    } else if (!sheet.headerValues.includes('Team PIN')) {
      console.log('Adding Team PIN column to existing headers');
      // If PIN column doesn't exist, we need to add it
      const currentHeaders = sheet.headerValues;
      currentHeaders.splice(2, 0, 'Team PIN'); // Insert PIN column after Team Name
      await sheet.setHeaderRow(currentHeaders);
    }

    // Check for duplicate PIN
    console.log('Checking for duplicate PIN');
    const rows = await sheet.getRows();
    const existingPin = rows.find(row => row.get('Team PIN') === teamPin);
    
    if (existingPin) {
      throw new Error(`PIN ${teamPin} is already in use by another team. Please choose a different PIN.`);
    }

    // Add the team data
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
        teamPin: teamPin,
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
