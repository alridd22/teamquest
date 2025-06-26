const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
  console.log('Function started');
  
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
    const { teamCode, teamName, teamPin } = JSON.parse(event.body);
    
    console.log('Team data received:', { teamCode, teamName, teamPin: teamPin ? '****' : undefined });

    if (!teamCode || !teamName || !teamPin) {
      throw new Error('Missing required fields');
    }

    if (!/^\d{4}$/.test(teamPin)) {
      throw new Error('PIN must be exactly 4 digits');
    }

    const sheetId = process.env.GOOGLE_SHEET_ID;
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    
    // Reconstruct private key from parts
    const keyPart1 = process.env.GOOGLE_PRIVATE_KEY_PART1;
    const keyPart2 = process.env.GOOGLE_PRIVATE_KEY_PART2;
    const keyPart3 = process.env.GOOGLE_PRIVATE_KEY_PART3;

    if (!sheetId || !serviceAccountEmail || !keyPart1 || !keyPart2 || !keyPart3) {
      throw new Error('Missing environment variables');
    }

    console.log('Reconstructing private key from parts');
    const privateKey = `${keyPart1}\n${keyPart2}\n${keyPart3}`;

    console.log('Creating JWT client');
    const serviceAccountAuth = new JWT({
      email: serviceAccountEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    console.log('Initializing Google Sheet');
    const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    
    console.log('Loading sheet info');
    await doc.loadInfo();
    
    const sheet = doc.sheetsByIndex[0];
    await sheet.loadHeaderRow();
    
    if (!sheet.headerValues || sheet.headerValues.length === 0) {
      console.log('Setting up headers');
      await sheet.setHeaderRow(['Team Code', 'Team Name', 'Team PIN', 'Registration Time']);
    }

    console.log('Checking for duplicate PIN');
    const rows = await sheet.getRows();
    const existingPin = rows.find(row => row.get('Team PIN') === teamPin);
    
    if (existingPin) {
      throw new Error(`PIN ${teamPin} is already in use. Please choose a different PIN.`);
    }

    console.log('Adding new team');
    await sheet.addRow({
      'Team Code': teamCode,
      'Team Name': teamName,
      'Team PIN': teamPin,
      'Registration Time': new Date().toISOString(),
    });

    console.log('Team registered successfully');

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
