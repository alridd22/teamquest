const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
  console.log('Leaderboard request started at:', new Date().toISOString());

  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
      body: '',
    };
  }

  try {
    // Get environment variables
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const privateKeyBase64 = process.env.GOOGLE_PRIVATE_KEY_B64;

    if (!serviceAccountEmail || !privateKeyBase64 || !sheetId) {
      throw new Error('Missing required environment variables');
    }

    // Decode private key
    let privateKey = Buffer.from(privateKeyBase64, 'base64').toString('utf8');
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    // Create JWT client
    const serviceAccountAuth = new JWT({
      email: serviceAccountEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    // Initialize Google Sheet
    const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    await doc.loadInfo();
    console.log('Sheet loaded successfully:', doc.title);

    // LOAD ONLY 2 SHEETS - MASSIVE REDUCTION IN API CALLS!
    
    // 1. Load competition status
    let competitionStartTime = null;
    try {
      const competitionSheet = doc.sheetsByTitle['Competition'];
      if (competitionSheet) {
        await competitionSheet.loadHeaderRow();
        const competitionRows = await competitionSheet.getRows();
        
        if (competitionRows.length > 0) {
          const competitionRow = competitionRows[0];
          const status = competitionRow.get('Status');
          const startTime = competitionRow.get('Start Time');
          
          if (status === 'start' && startTime) {
            competitionStartTime = startTime;
            console.log('Competition started at:', competitionStartTime);
          }
        }
      }
    } catch (error) {
      console.log('Competition sheet error:', error.message);
    }

    // 2. Load leaderboard data (Google Sheets has done all the calculations!)
    const leaderboardSheet = doc.sheetsByTitle['Leaderboard'];
    if (!leaderboardSheet) {
      throw new Error('Leaderboard sheet not found. Please create a "Leaderboard" sheet with calculated totals.');
    }

    await leaderboardSheet.loadHeaderRow();
    const leaderboardRows = await leaderboardSheet.getRows();
    console.log('Leaderboard rows loaded:', leaderboardRows.length);
    console.log('Leaderboard headers:', leaderboardSheet.headerValues);

    // Process leaderboard data (Google Sheets has already done the calculations!)
    const teams = [];
    const leaderboard = [];

    leaderboardRows.forEach(row => {
      const teamCode = row.get('Team Code');
      const teamName = row.get('Team Name');
      
      if (teamCode && teamName) {
        const teamData = {
          teamCode: teamCode,
          teamName: teamName,
          totalScore: parseInt(row.get('Total Score')) || 0,
          activities: {
            registration: parseInt(row.get('Registration')) || 0,
            clueHunt: parseInt(row.get('Clue Hunt')) || 0,
            quiz: parseInt(row.get('Quiz')) || 0,
            kindness: parseInt(row.get('Kindness')) || 0,
            limerick: parseInt(row.get('Limerick')) || 0,
            scavenger: parseInt(row.get('Scavenger')) || 0
          },
          members: row.get('Members') || '',
          registrationTime: row.get('Registration Time') || ''
        };

        teams.push(teamData);

        // Add to leaderboard if team has any score
        if (teamData.totalScore > 0) {
          leaderboard.push({
            teamCode: teamData.teamCode,
            teamName: teamData.teamName,
            totalScore: teamData.totalScore,
            registration: teamData.activities.registration,
            clueHunt: teamData.activities.clueHunt,
            quiz: teamData.activities.quiz,
            kindness: teamData.activities.kindness,
            limerick: teamData.activities.limerick,
            scavenger: teamData.activities.scavenger
          });
        }
      }
    });

    // Sort by total score (descending) - could also be done in Google Sheets!
    leaderboard.sort((a, b) => b.totalScore - a.totalScore);

    // Add positions
    leaderboard.forEach((team, index) => {
      team.position = index + 1;
    });

    const timestamp = Date.now();
    console.log('Processed', teams.length, 'teams,', leaderboard.length, 'on leaderboard');

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'X-Timestamp': timestamp.toString(),
      },
      body: JSON.stringify({
        success: true,
        teams: teams,
        leaderboard: leaderboard,
        lastUpdated: new Date().toISOString(),
        competitionStartTime: competitionStartTime,
        timestamp: timestamp,
        debugInfo: {
          teamsCount: teams.length,
          leaderboardCount: leaderboard.length,
          dataSource: 'Single Leaderboard Sheet',
          competitionStatus: competitionStartTime ? 'Started' : 'Not Started',
          competitionStartTime: competitionStartTime,
          apiCallsUsed: 2, // Only Competition + Leaderboard sheets!
          sheetsProcessed: ['Competition', 'Leaderboard']
        }
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
        timestamp: Date.now()
      }),
    };
  }
};
