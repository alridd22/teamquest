exports.handler = async (event, context) => {
  console.log('Leaderboard function started');
  
  // Handle preflight CORS requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: {'Access-Control-Allow-Origin': '*'},
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const apiKey = process.env.GOOGLE_API_KEY;

    if (!sheetId || !apiKey) {
      throw new Error('Missing environment variables');
    }

    console.log('Fetching leaderboard data from Google Sheets');
    
    // Fetch leaderboard data from the Leaderboard tab
    const leaderboardUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Leaderboard!A:K?key=${apiKey}`;
    const response = await fetch(leaderboardUrl);
    
    if (!response.ok) {
      throw new Error(`Google Sheets API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    const rows = data.values;
    
    if (!rows || rows.length < 2) {
      throw new Error('No data found in Leaderboard sheet');
    }
    
    // Parse the data (skip header row)
    const teams = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row[0] && row[1]) { // Must have team code and name
        teams.push({
          teamCode: row[0] || '',
          teamName: row[1] || '',
          registration: parseInt(row[2]) || 0,
          clueHunt: parseInt(row[3]) || 0,
          quiz: parseInt(row[4]) || 0,
          kindness: parseInt(row[5]) || 0,
          scavenger: parseInt(row[6]) || 0,
          limerick: parseInt(row[7]) || 0,
          totalScore: parseInt(row[8]) || 0,
          status: row[9] || 'active',
          locked: row[10] === 'TRUE' || false
        });
      }
    }
    
    // Sort by total score and assign ranks
    teams.sort((a, b) => b.totalScore - a.totalScore);
    teams.forEach((team, index) => {
      team.rank = index + 1;
    });
    
    console.log('Successfully loaded', teams.length, 'teams');

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
      body: JSON.stringify({
        success: true,
        teams: teams,
        lastUpdated: new Date().toISOString()
      }),
    };

  } catch (error) {
    console.error('Leaderboard error:', error);
    
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