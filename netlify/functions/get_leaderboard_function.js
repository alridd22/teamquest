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

    // 1. Load competition status
    let competitionStartTime = null;
    let competitionDuration = null;
    try {
      const competitionSheet = doc.sheetsByTitle['Competition'];
      if (competitionSheet) {
        await competitionSheet.loadHeaderRow();
        console.log('Competition sheet headers:', competitionSheet.headerValues);
        
        const competitionRows = await competitionSheet.getRows();
        console.log('Competition rows found:', competitionRows.length);
        
        if (competitionRows.length > 0) {
          const competitionRow = competitionRows[0];
          console.log('Competition row raw data:', competitionRow._rawData);
          
          const status = competitionRow.get('Status');
          const startTime = competitionRow.get('Start Time');
          const duration = competitionRow.get('Duration Minutes');
          
          console.log('Competition data read:', { status, startTime, duration });
          
          if (status === 'start' && startTime) {
            competitionStartTime = startTime;
            competitionDuration = parseInt(duration) || 90;
            console.log('Competition active! Start:', competitionStartTime, 'Duration:', competitionDuration);
            console.log('Duration type:', typeof competitionDuration, 'Value:', competitionDuration);
          } else {
            console.log('Competition not active. Status:', status, 'StartTime:', startTime);
          }
        } else {
          console.log('No competition rows found');
        }
      } else {
        console.log('Competition sheet not found');
      }
    } catch (error) {
      console.log('Competition sheet error:', error.message);
    }

    // 2. Load leaderboard data
    const leaderboardSheet = doc.sheetsByTitle['Leaderboard'];
    if (!leaderboardSheet) {
      throw new Error('Leaderboard sheet not found. Please create a "Leaderboard" sheet with calculated totals.');
    }

    await leaderboardSheet.loadHeaderRow();
    const leaderboardRows = await leaderboardSheet.getRows();
    console.log('Leaderboard rows loaded:', leaderboardRows.length);
    console.log('Leaderboard headers:', leaderboardSheet.headerValues);

    // Process leaderboard data
    const teams = [];
    const leaderboard = [];

    leaderboardRows.forEach(row => {
      const teamCode = row.get('Team Code');
      const teamName = row.get('Team Name');
      
      if (teamCode && teamName) {
        const teamData = {
          teamCode: teamCode,
          teamName: teamName,
          // FIXED: Changed 'Total Score' to 'Total' to match your Google Sheet
          totalScore: parseInt(row.get('Total')) || 0,
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

        // FIXED: Changed > 0 to >= 0 so teams with 0 points still show
        if (teamData.totalScore >= 0) {
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

    // Sort by total score (descending)
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
        competitionDuration: competitionDuration,
        timestamp: timestamp,
        debugInfo: {
          teamsCount: teams.length,
          leaderboardCount: leaderboard.length,
          dataSource: 'Single Leaderboard Sheet',
          competitionStatus: competitionStartTime ? 'Started' : 'Not Started',
          competitionStartTime: competitionStartTime,
          competitionDuration: competitionDuration,
          apiCallsUsed: 2,
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
