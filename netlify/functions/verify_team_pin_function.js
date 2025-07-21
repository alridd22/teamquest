exports.handler = async (event, context) => {
  console.log('Team PIN verification started');
  
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
    const { teamCode, pin } = JSON.parse(event.body);
    
    console.log('Verifying PIN for team:', teamCode);

    if (!teamCode || !pin) {
      throw new Error('Missing teamCode or pin');
    }

    // Validate PIN format
    if (!/^\d{4}$/.test(pin)) {
      throw new Error('PIN must be exactly 4 digits');
    }

    const sheetId = process.env.GOOGLE_SHEET_ID;
    const apiKey = process.env.GOOGLE_API_KEY;

    if (!sheetId || !apiKey) {
      throw new Error('Missing environment variables');
    }

    console.log('Fetching registration data from Google Sheets');
    
    // Fetch registration data from Sheet1 (where team registrations with PINs are stored)
    const registrationUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A:D?key=${apiKey}`;
    const response = await fetch(registrationUrl);
    
    if (!response.ok) {
      throw new Error(`Google Sheets API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    const rows = data.values;
    
    if (!rows || rows.length < 2) {
      throw new Error('No registration data found');
    }
    
    console.log('Found', rows.length - 1, 'registered teams');
    
    // Look for matching team code and PIN
    // Expected format: [Team Code, Team Name, Team PIN, Registration Time]
    let teamFound = false;
    let pinMatches = false;
    let foundTeamData = null;
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowTeamCode = row[0];
      const rowTeamName = row[1];
      const rowTeamPin = row[2];
      
      console.log(`Row ${i}: Code="${rowTeamCode}", Name="${rowTeamName}", PIN="${rowTeamPin}"`);
      
      if (rowTeamCode === teamCode) {
        teamFound = true;
        foundTeamData = { code: rowTeamCode, name: rowTeamName, pin: rowTeamPin };
        console.log('Team found:', rowTeamName, 'Expected PIN:', rowTeamPin, 'Received PIN:', pin);
        
        // Convert both to strings for comparison
        if (String(rowTeamPin).trim() === String(pin).trim()) {
          pinMatches = true;
          console.log('PIN matches for team:', teamCode);
          break;
        } else {
          console.log('PIN does not match. Expected:', `"${rowTeamPin}"`, 'Got:', `"${pin}"`);
          console.log('Types - Expected:', typeof rowTeamPin, 'Got:', typeof pin);
        }
        break;
      }
    }
    
    if (!teamFound) {
      console.log('Team code not found:', teamCode);
      console.log('Available teams:', rows.slice(1).map(row => row[0]).join(', '));
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          success: true,
          valid: false,
          message: 'Team not found',
          debug: { searchedFor: teamCode, availableTeams: rows.slice(1).map(row => row[0]) }
        }),
      };
    }
    
    if (!pinMatches) {
      console.log('PIN verification failed for team:', teamCode);
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          success: true,
          valid: false,
          message: 'Incorrect PIN',
          debug: { 
            foundTeam: foundTeamData,
            receivedPin: pin,
            pinComparison: `Expected: "${foundTeamData?.pin}" vs Received: "${pin}"`
          }
        }),
      };
    }
    
    console.log('PIN verification successful for team:', teamCode);
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        valid: true,
        message: 'PIN verified successfully'
      }),
    };

  } catch (error) {
    console.error('PIN verification error:', error);
    
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
