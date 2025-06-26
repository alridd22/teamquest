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

    console.log('Using sheet ID:', sheetId);
    console.log('API key present:', !!apiKey);

    // Try reading first to check permissions
    console.log('Testing sheet access...');
    const testUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A1:D1000?key=${apiKey}`;
    const testResponse = await fetch(testUrl);
    
    console.log('Test response status:', testResponse.status);
    
    if (!testResponse.ok) {
      const errorText = await testResponse.text();
      console.log('Test error:', errorText);
      throw new Error(`Sheet access failed: ${testResponse.status} - ${errorText}`);
    }
    
    const sheetData = await testResponse.json();
    console.log('Sheet data retrieved, rows:', sheetData.values ? sheetData.values.length : 0);
    
    // Check existing PINs (column C = index 2)
    if (sheetData.values && sheetData.values.length > 1) {
      const existingPins = sheetData.values.slice(1).map(row => row[2]).filter(pin => pin);
      console.log('Existing PINs found:', existingPins.length);
      if (existingPins.includes(teamPin)) {
        throw new Error(`PIN ${teamPin} is already in use. Please choose a different PIN.`);
      }
    }
    
    // Use batchUpdate instead of append for better API key compatibility
    console.log('Adding new row using batchUpdate...');
    const newRowIndex = sheetData.values ? sheetData.values.length + 1 : 2;
    const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A${newRowIndex}:D${newRowIndex}?valueInputOption=RAW&key=${apiKey}`;
    
    const updateResponse = await fetch(updateUrl, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        values: [[teamCode, teamName, teamPin, new Date().toISOString()]]
      })
    });
    
    console.log('Update response status:', updateResponse.status);
    
    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.log('Update error:', errorText);
      throw new Error(`Failed to save data: ${updateResponse.status} - ${errorText}`);
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
