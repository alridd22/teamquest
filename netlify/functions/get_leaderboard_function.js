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

    // Fetch scores from all activity sheets
    console.log('Fetching scores from all activity sheets');
    
    const activitySheets = ['Kindness']; // Start with just Kindness for now
    const activityScores = {
      kindness: {}
    };

    // Fetch scores from each activity sheet
    for (const sheetName of activitySheets) {
      try {
        console.log(`Fetching ${sheetName} scores`);
        const activityUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${sheetName}!A:G?key=${apiKey}`;
        const activityResponse = await fetch(activityUrl);
        
        if (activityResponse.ok) {
          const activityData = await activityResponse.json();
          const activityRows = activityData.values;
          
          if (activityRows && activityRows.length > 1) {
            const scoreKey = sheetName.toLowerCase().replace(' ', '');
            
            // Process activity scores (skip header row)
            for (let i = 1; i < activityRows.length; i++) {
              const row = activityRows[i];
              if (!row || row.length === 0) continue;
              
              const teamCode = row[0]; // Team Code
              
              // For Kindness sheet, score is in column G (index 6)
              let score = null;
              if (sheetName === 'Kindness' && row[6] && !isNaN(parseFloat(row[6])) && row[6] !== 'Pending AI Score') {
                score = parseFloat(row[6]);
              }
              
              if (teamCode && score !== null) {
                if (!activityScores[scoreKey][teamCode]) {
                  activityScores[scoreKey][teamCode] = 0;
                }
                activityScores[scoreKey][teamCode] += score;
              }
            }
            console.log(`${sheetName} scores processed:`, activityScores[scoreKey]);
          }
        } else {
          console.log(`${sheetName} sheet not found or not accessible`);
        }
      } catch (error) {
        console.error(`Error fetching ${sheetName} scores:`, error.message);
        // Continue with other sheets even if one fails
      }
    }

    if (!leaderboardRows || leaderboardRows.length < 2) {
      throw new Error('No leaderboard data found');
    }

    console.log('Processing leaderboard data with kindness scores');
    
    const teams = [];
    const headers = leaderboardRows[0];
    
    // Find column indices
    const teamCodeIndex = headers.findIndex(h => h.toLowerCase().includes('team') && h.toLowerCase().includes('code'));
    const teamNameIndex = headers.findIndex(h => h.toLowerCase().includes('team') && h.toLowerCase().includes('name'));
    const registrationIndex = headers.findIndex(h => h.toLowerCase().includes('registration'));
    const clueHuntIndex = headers.findIndex(h => h.toLowerCase().includes('clue'));
    const quizIndex = headers.findIndex(h => h.toLowerCase().includes('quiz'));
    const kindnessIndex = headers.findIndex(h => h.toLowerCase().includes('kindness'));
    const scavengerIndex = headers.findIndex(h => h.toLowerCase().includes('scavenger'));
    const limerickIndex = headers.findIndex(h => h.toLowerCase().includes('limerick'));
    const statusIndex = headers.findIndex(h => h.toLowerCase().includes('status'));

    // Process each team
    for (let i = 1; i < leaderboardRows.length; i++) {
      const row = leaderboardRows[i];
      if (!row || row.length === 0) continue;
      
      const teamCode = row[teamCodeIndex] || '';
      const teamName = row[teamNameIndex] || '';
      
      if (!teamCode || !teamName) continue;

      // Get scores from leaderboard sheet
      const registration = parseFloat(row[registrationIndex]) || 0;
      const clueHunt = parseFloat(row[clueHuntIndex]) || 0;
      const quiz = parseFloat(row[quizIndex]) || 0;
      const scavenger = parseFloat(row[scavengerIndex]) || 0;
      const limerick = parseFloat(row[limerickIndex]) || 0;
      
      // Get scores from leaderboard sheet and activity sheets
      const registration = parseFloat(row[registrationIndex]) || 0;
      const clueHunt = parseFloat(row[clueHuntIndex]) || 0;
      const quiz = parseFloat(row[quizIndex]) || 0;
      const scavenger = parseFloat(row[scavengerIndex]) || 0;
      const limerick = parseFloat(row[limerickIndex]) || 0;
      
      // Get kindness score from kindness sheet (overrides leaderboard sheet if available)
      const kindness = activityScores.kindness[teamCode] || parseFloat(row[kindnessIndex]) || 0;
      
      const status = row[statusIndex] || 'active';
      
      const totalScore = registration + clueHunt + quiz + kindness + scavenger + limerick;

      teams.push({
        teamCode,
        teamName,
        registration,
        clueHunt: clueHuntActivity,
        quiz: quizActivity,
        kindness,
        scavenger: scavengerActivity,
        limerick: limerickActivity,
        totalScore,
        status: status.toLowerCase(),
        locked: status.toLowerCase() === 'returned'
      });
    }

    // Sort by total score (highest first)
    teams.sort((a, b) => b.totalScore - a.totalScore);

    console.log(`Processed ${teams.length} teams with all activity scores integrated`);

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
