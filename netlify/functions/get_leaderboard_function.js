const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
  console.log('Leaderboard request started at:', new Date().toISOString());

  // Handle CORS with cache busting headers
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      },
      body: ''
    };
  }

  try {
    // Initialize Google Sheets authentication
    const serviceAccountAuth = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SPREADSHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    console.log('Spreadsheet loaded:', doc.title);

    // Load the main sheet (assuming first sheet contains team data)
    const sheet = doc.sheetsByIndex[0];
    await sheet.loadHeaderRow();
    await sheet.loadCells();
    
    console.log('Sheet headers:', sheet.headerValues);
    const rows = await sheet.getRows();
    console.log('Total rows found:', rows.length);

    // Process team data
    const allTeams = [];
    const leaderboard = [];

    rows.forEach((row, index) => {
      try {
        const teamData = {
          teamCode: row['Team Code'] || row['teamCode'] || '',
          teamName: row['Team Name'] || row['teamName'] || '',
          registration: parseInt(row['Registration'] || row['registration'] || 0),
          clueHunt: parseInt(row['Clue Hunt'] || row['clueHunt'] || 0),
          quiz: parseInt(row['Quiz'] || row['quiz'] || 0),
          kindness: parseInt(row['Kindness'] || row['kindness'] || 0),
          limerick: parseInt(row['Limerick'] || row['limerick'] || 0),
          scavenger: parseInt(row['Scavenger'] || row['scavenger'] || 0),
          status: row['Status'] || row['status'] || 'active',
          locked: row['Locked'] || row['locked'] || false
        };

        // Calculate total score
        teamData.totalScore = teamData.registration + teamData.clueHunt + teamData.quiz + 
                             teamData.kindness + teamData.limerick + teamData.scavenger;

        // Add to teams array
        allTeams.push(teamData);

        // Add to leaderboard if team has activity
        if (teamData.totalScore > 0) {
          leaderboard.push({
            position: 0, // Will be set after sorting
            teamName: teamData.teamName,
            teamCode: teamData.teamCode,
            totalScore: teamData.totalScore,
            registration: teamData.registration,
            clueHunt: teamData.clueHunt,
            quiz: teamData.quiz,
            kindness: teamData.kindness,
            limerick: teamData.limerick,
            scavenger: teamData.scavenger
          });
        }
      } catch (error) {
        console.error(`Error processing row ${index}:`, error);
      }
    });

    // Sort leaderboard by total score (descending)
    leaderboard.sort((a, b) => b.totalScore - a.totalScore);

    // Assign positions
    leaderboard.forEach((team, index) => {
      team.position = index + 1;
    });

    // READ COMPETITION START TIME FROM COMPETITION SHEET
    let competitionStartTime = null;

    try {
      // Access the Competition sheet
      const competitionSheet = doc.sheetsByTitle['Competition'];
      
      if (competitionSheet) {
        console.log('Competition sheet found');
        await competitionSheet.loadHeaderRow();
        const competitionRows = await competitionSheet.getRows();
        
        if (competitionRows.length > 0) {
          // Get the most recent entry
          const latestEntry = competitionRows[competitionRows.length - 1];
          
          // Check if competition is started
          if (latestEntry.Status === 'start' && latestEntry['Start Time']) {
            competitionStartTime = latestEntry['Start Time'];
            console.log('Competition start time found:', competitionStartTime);
          } else {
            console.log('Competition not started or no start time found');
          }
        } else {
          console.log('No entries in Competition sheet');
        }
      } else {
        console.log('Competition sheet not found');
      }
    } catch (error) {
      console.error('Error reading Competition sheet:', error);
    }

    const timestamp = new Date().toISOString();

    // Return successful response with competition start time
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      },
      body: JSON.stringify({
        success: true,
        teams: allTeams,
        leaderboard,
        lastUpdated: timestamp,
        competitionStartTime: competitionStartTime, // THIS IS THE KEY ADDITION
        timestamp: timestamp,
        debugInfo: {
          totalTeams: allTeams.length,
          activeTeams: leaderboard.length,
          sheetTitle: sheet.title,
          competitionStartTime: competitionStartTime,
          lastUpdated: timestamp
        }
      }),
    };

  } catch (error) {
    console.error('Leaderboard function error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: 'Failed to load leaderboard data',
        details: error.message,
        timestamp: new Date().toISOString()
      }),
    };
  }
};
