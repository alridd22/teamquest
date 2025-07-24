exports.handler = async (event, context) => {
  console.log('Leaderboard request started');

  // Handle CORS
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

  try {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const apiKey = process.env.GOOGLE_API_KEY;

    if (!sheetId || !apiKey) {
      throw new Error('Missing environment variables');
    }

    console.log('Fetching data from Google Sheets');

    // Fetch main leaderboard data
    const leaderboardUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Leaderboard!A:J?key=${apiKey}`;
    const leaderboardResponse = await fetch(leaderboardUrl);
    
    if (!leaderboardResponse.ok) {
      throw new Error(`Leaderboard API error: ${leaderboardResponse.status}`);
    }
    
    const leaderboardData = await leaderboardResponse.json();
    const leaderboardRows = leaderboardData.values;

    // Fetch kindness scores
    console.log('Fetching Kindness scores');
    let kindnessScores = {};
    
    try {
      const kindnessUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Kindness!A:G?key=${apiKey}`;
      const kindnessResponse = await fetch(kindnessUrl);
      
      if (kindnessResponse.ok) {
        const kindnessData = await kindnessResponse.json();
        const kindnessRows = kindnessData.values;
        
        if (kindnessRows && kindnessRows.length > 1) {
          // Process kindness scores (skip header row)
          for (let i = 1; i < kindnessRows.length; i++) {
            const row = kindnessRows[i];
            if (!row || row.length === 0) continue;
            
            const teamCode = row[0]; // Team Code
            const aiScore = row[6];   // AI Score column
            
            // Only count numeric scores (ignore "Pending AI Score")
            if (teamCode && aiScore && !isNaN(parseFloat(aiScore)) && aiScore !== 'Pending AI Score') {
              if (!kindnessScores[teamCode]) {
                kindnessScores[teamCode] = 0;
              }
              kindnessScores[teamCode] += parseFloat(aiScore);
            }
          }
          console.log('Kindness scores processed:', kindnessScores);
        }
      } else {
        console.log('Kindness sheet not found or not accessible');
      }
    } catch (kindnessError) {
      console.error('Error fetching kindness scores:', kindnessError.message);
    }

    if (!leaderboardRows || leaderboardRows.length < 2) {
      throw new Error('No leaderboard data found');
    }

    console.log('Processing leaderboard data with kindness scores');
    
    const teams = [];
    const headers = leaderboardRows[0];
    
    // Find column indices safely
    const teamCodeCol = headers.findIndex(h => h && h.toLowerCase().includes('team') && h.toLowerCase().includes('code'));
    const teamNameCol = headers.findIndex(h => h && h.toLowerCase().includes('team') && h.toLowerCase().includes('name'));
    const regCol = headers.findIndex(h => h && h.toLowerCase().includes('registration'));
    const clueCol = headers.findIndex(h => h && h.toLowerCase().includes('clue'));
    const quizCol = headers.findIndex(h => h && h.toLowerCase().includes('quiz'));
    const kindCol = headers.findIndex(h => h && h.toLowerCase().includes('kindness'));
    const scavCol = headers.findIndex(h => h && h.toLowerCase().includes('scavenger'));
    const limCol = headers.findIndex(h => h && h.toLowerCase().includes('limerick'));
    const statusCol = headers.findIndex(h => h && h.toLowerCase().includes('status'));

    console.log('Column indices found:', {
      teamCodeCol,
      teamNameCol,
      regCol,
      kindCol
    });

    // Process each team from leaderboard
    for (let i = 1; i < leaderboardRows.length; i++) {
      const row = leaderboardRows[i];
      if (!row || row.length === 0) continue;
      
      const teamCode = row[teamCodeCol] || '';
      const teamName = row[teamNameCol] || '';
      
      if (!teamCode || !teamName) {
        console.log(`Skipping row ${i}: missing team code or name`);
        continue;
      }

      console.log(`Processing team: ${teamCode} - ${teamName}`);

      // Get scores safely
      const regScore = parseFloat(row[regCol]) || 0;
      const clueScore = parseFloat(row[clueCol]) || 0;
      const quizScore = parseFloat(row[quizCol]) || 0;
      const scavScore = parseFloat(row[scavCol]) || 0;
      const limScore = parseFloat(row[limCol]) || 0;
      
      // Use kindness score from activity sheet if available, otherwise from leaderboard
      const kindScore = kindnessScores[teamCode] || parseFloat(row[kindCol]) || 0;
      
      const teamStatus = row[statusCol] || 'active';
      const total = regScore + clueScore + quizScore + kindScore + scavScore + limScore;

      teams.push({
        teamCode: teamCode,
        teamName: teamName,
        registration: regScore,
        clueHunt: clueScore,
        quiz: quizScore,
        kindness: kindScore,
        scavenger: scavScore,
        limerick: limScore,
        totalScore: total,
        status: teamStatus.toLowerCase(),
        locked: teamStatus.toLowerCase() === 'returned'
      });
    }

    // Add any teams that are only in kindness sheet but not in leaderboard
    const existingTeamCodes = new Set(teams.map(t => t.teamCode));
    
    for (const [teamCode, kindScore] of Object.entries(kindnessScores)) {
      if (!existingTeamCodes.has(teamCode)) {
        console.log(`Adding team from kindness sheet: ${teamCode}`);
        teams.push({
          teamCode: teamCode,
          teamName: teamCode, // Use team code as name if no name available
          registration: 0,
          clueHunt: 0,
          quiz: 0,
          kindness: kindScore,
          scavenger: 0,
          limerick: 0,
          totalScore: kindScore,
          status: 'active',
          locked: false
        });
      }
    }

    // Sort by total score (highest first)
    teams.sort((a, b) => b.totalScore - a.totalScore);

    console.log(`Processed ${teams.length} teams with kindness integration`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
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
