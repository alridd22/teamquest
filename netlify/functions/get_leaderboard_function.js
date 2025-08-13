const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
  console.log('=== REAL GOOGLE SHEETS FUNCTION STARTED ===');
  console.log('Timestamp:', new Date().toISOString());
  
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
    console.log('Connected to Google Sheets successfully');

    // Load Competition sheet for timer
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
        console.log('Competition start time:', competitionStartTime);
      }
      
      if (durationValue) {
        competitionDuration = parseInt(durationValue);
        console.log('Competition duration:', competitionDuration, 'minutes');
      }
    }

    // Load Leaderboard sheet
    const leaderboardSheet = doc.sheetsByTitle['Leaderboard'];
    if (!leaderboardSheet) {
      throw new Error('Leaderboard sheet not found');
    }

    const leaderboardRows = await leaderboardSheet.getRows();
    console.log('Leaderboard rows loaded:', leaderboardRows.length);

    // Log headers to verify column names
    console.log('Sheet headers:', leaderboardSheet.headerValues);

    // Process leaderboard data
    const teams = [];
    const leaderboard = [];
    
    console.log('About to process leaderboard rows...');

    leaderboardRows.forEach((row, index) => {
      console.log(`\n--- Processing row ${index + 2} ---`);
      console.log('Raw row data:', row._rawData);
      
      const teamCode = row.get('Team Code');
      const teamName = row.get('Team Name');
      
      console.log('Team Code:', teamCode);
      console.log('Team Name:', teamName);
      
      if (teamCode && teamName) {
        // Get individual activity scores
        const registration = parseInt(row.get('Registration')) || 0;
        const clueHunt = parseInt(row.get('Clue Hunt')) || 0;
        const quiz = parseInt(row.get('Quiz')) || 0;
        const kindness = parseInt(row.get('Kindness')) || 0;
        const scavenger = parseInt(row.get('Scavenger')) || 0;
        const limerick = parseInt(row.get('Limerick')) || 0;
        
        // Get total from sheet
        const totalFromSheet = row.get('Total');
        const totalScore = parseInt(totalFromSheet) || 0;
        
        console.log('Activity scores:', {
          registration,
          clueHunt,
          quiz,
          kindness,
          scavenger,
          limerick
        });
        console.log('Total from sheet:', totalFromSheet);
        console.log('Parsed totalScore:', totalScore);

        // Create team data (nested structure)
        const teamData = {
          teamCode,
          teamName,
          totalScore,
          activities: {
            registration,
            clueHunt,
            quiz,
            kindness,
            scavenger,
            limerick
          }
        };

        // Create leaderboard entry (flattened structure)
        const leaderboardEntry = {
          teamCode,
          teamName,
          totalScore,
          registration,
          clueHunt,
          quiz,
          kindness,
          scavenger,
          limerick
        };

        teams.push(teamData);
        console.log(`Team ${teamCode} added to teams array`);

        // Add to leaderboard if they have any score
        if (totalScore >= 0) {  // Include all teams, even with 0 score
          leaderboard.push(leaderboardEntry);
          console.log(`Team ${teamCode} added to leaderboard with score ${totalScore}`);
        } else {
          console.log(`Team ${teamCode} NOT added to leaderboard (score: ${totalScore})`);
        }
      } else {
        console.log('Skipping row - missing team code or name');
      }
    });

    console.log(`\n=== PROCESSING COMPLETE ===`);
    console.log(`Processed ${teams.length} teams, ${leaderboard.length} on leaderboard`);

    // Sort leaderboard by score
    leaderboard.sort((a, b) => b.totalScore - a.totalScore);

    const response = {
      success: true,
      teams,
      leaderboard,
      competitionStartTime,
      competitionDuration,
      teamsCount: teams.length,
      dataSource: "Real Google Sheets",
      timestamp: new Date().toISOString(),
      debugInfo: {
        message: "THIS IS REAL DATA - WORKING!",
        teamsCount: teams.length,
        leaderboardCount: leaderboard.length
      }
    };

    console.log('Final response preview:', {
      success: response.success,
      teamsCount: response.teams.length,
      leaderboardCount: response.leaderboard.length,
      dataSource: response.dataSource
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify(response)
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
