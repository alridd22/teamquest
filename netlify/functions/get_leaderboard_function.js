const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
  try {
    // Create JWT client
    const jwt = new JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/spreadsheets']
    });

    // Create document
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, jwt);
    await doc.loadInfo();

    // Load Competition sheet
    const competitionSheet = doc.sheetsByTitle['Competition'];
    if (!competitionSheet) {
      throw new Error('Competition sheet not found');
    }
    
    const competitionRows = await competitionSheet.getRows();
    console.log('Competition rows loaded:', competitionRows.length);

    // Get competition data
    let competitionStartTime = null;
    let competitionDuration = null;

    if (competitionRows.length > 0) {
      const startTimeValue = competitionRows[0].get('Competition Start Time');
      const durationValue = competitionRows[0].get('Competition Duration (minutes)');
      
      if (startTimeValue) {
        competitionStartTime = new Date(startTimeValue).toISOString();
      }
      
      if (durationValue) {
        competitionDuration = parseInt(durationValue);
      }
    }

    // Load Leaderboard sheet
    const leaderboardSheet = doc.sheetsByTitle['Leaderboard'];
    if (!leaderboardSheet) {
      throw new Error('Leaderboard sheet not found');
    }

    const leaderboardRows = await leaderboardSheet.getRows();
    console.log('Leaderboard rows loaded:', leaderboardRows.length);

    // Process leaderboard data
    const teams = [];
    const leaderboard = [];

    leaderboardRows.forEach(row => {
      const teamCode = row.get('Team Code');
      const teamName = row.get('Team Name');
      
      if (teamCode && teamName) {
        // FIXED: Changed 'Total Score' to 'Total' to match your Google Sheet
        const totalScore = parseInt(row.get('Total')) || 0;
        
        const teamData = {
          teamCode,
          teamName,
          totalScore,
          activities: {
            registration: parseInt(row.get('Registration')) || 0,
            clueHunt: parseInt(row.get('Clue Hunt')) || 0,
            quiz: parseInt(row.get('Quiz')) || 0,
            kindness: parseInt(row.get('Kindness')) || 0,
            scavenger: parseInt(row.get('Scavenger')) || 0,
            limerick: parseInt(row.get('Limerick')) || 0
          }
        };

        teams.push(teamData);

        // FIXED: Changed > 0 to >= 0 so teams with 0 points still show
        if (totalScore >= 0) {
          leaderboard.push(teamData);
        }
      }
    });

    console.log(`Processed ${teams.length} teams, ${leaderboard.length} on leaderboard`);

    // Sort leaderboard by score
    leaderboard.sort((a, b) => b.totalScore - a.totalScore);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({
        success: true,
        teams,
        leaderboard,
        competitionStartTime,
        competitionDuration,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('Error in leaderboard function:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};
