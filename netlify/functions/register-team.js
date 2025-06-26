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
    const apiKey = process.env.GOOGLE_API_KEY;

    if (!sheetId || !apiKey) {
      throw new Error('Missing environment variables');
    }

    // Check for duplicate PINs
    const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1?key=${apiKey}`;
    const getResponse = await fetch(getUrl);
    
    if (!getResponse.ok) {
      throw new Error(`Sheet access failed: ${getResponse.statusText}`);
    }
    
    const sheetData = await getResponse.json();
    
    // Check existing PINs (column C = index 2)
    if (sheetData.values && sheetData.values.length > 1) {
      const existingPins = sheetData.values.slice(1).map(row => row[2]).filter(pin => pin);
      if (existingPins.includes(teamPin)) {
        throw new Error(`PIN ${teamPin} is already in use. Please choose a different PIN.`);
      }
    }
    
    // Add new row
    const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1:append?valueInputOption=RAW&key=${apiKey}`;
    const appendResponse = await fetch(appendUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        values: [[teamCode, teamName, teamPin, new Date().toISOString()]]
      })
    });
    
    if (!appendResponse.ok) {
      throw new Error(`Failed to save data: ${appendResponse.statusText}`);
    }
    
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
