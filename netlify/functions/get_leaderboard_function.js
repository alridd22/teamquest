const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
  console.log('Enhanced leaderboard request started at:', new Date().toISOString());

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

    // 1. Load competition status (enhanced with penalty support)
    let competitionStartTime = null;
    let competitionDuration = null;
    let resultsPublished = false;
    let competitionStatus = 'stopped';
    let startTime = null;
    let durationMinutes = 90;
    let published = null;
    
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
          const startTimeValue = competitionRow.get('Start Time');
          const duration = competitionRow.get('Duration Minutes');
          published = competitionRow.get('Results Published');
          
          console.log('Competition data read:', { status, startTimeValue, duration, published });
          
          competitionStatus = status || 'stopped';
          startTime = startTimeValue;
          durationMinutes = parseInt(duration) || 90;
          
          // Handle all possible published values from Google Sheets
          resultsPublished = published === true || 
                            published === 'true' || 
                            published === 'TRUE' || 
                            published === 'yes' || 
                            published === 'YES';
                            
          console.log('Results published check - raw value:', published, 'type:', typeof published, 'result:', resultsPublished);
          
          if (status === 'start' && startTimeValue) {
            competitionStartTime = startTimeValue;
            competitionDuration = parseInt(duration) || 90;
            console.log('Competition active! Start:', competitionStartTime, 'Duration:', competitionDuration);
          } else {
            console.log('Competition not active. Status:', status, 'StartTime:', startTimeValue);
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

    // 2. Load leaderboard data with penalty support
    const leaderboardSheet = doc.sheetsByTitle['Leaderboard'];
    if (!leaderboardSheet) {
      throw new Error('Leaderboard sheet not found. Please create a "Leaderboard" sheet with calculated totals.');
    }

    await leaderboardSheet.loadHeaderRow();
    const leaderboardRows = await leaderboardSheet.getRows();
    console.log('Leaderboard rows loaded:', leaderboardRows.length);
    console.log('Leaderboard headers:', leaderboardSheet.headerValues);

    // Process leaderboard data with penalty information
    const teams = [];
    const leaderboard = [];

    leaderboardRows.forEach(row => {
      const teamCode = row.get('Team Code');
      const teamName = row.get('Team Name');
      
      if (teamCode && teamName) {
        // Get basic scores
        const originalTotal = parseInt(row.get('Total')) || 0;
        const registration = parseInt(row.get('Registration')) || 0;
        const clueHunt = parseInt(row.get('Clue Hunt')) || 0;
        const quiz = parseInt(row.get('Quiz')) || 0;
        const kindness = parseInt(row.get('Kindness')) || 0;
        const limerick = parseInt(row.get('Limerick')) || 0;
        const scavenger = parseInt(row.get('Scavenger')) || 0;

        // Get penalty information (with safe defaults)
        const status = safeGet(row, 'Status', 'active');
        const penalty = parseInt(safeGet(row, 'Penalty', '0')) || 0;
        const returnTime = safeGet(row, 'Return Time', null);
        const penaltyMinutes = parseInt(safeGet(row, 'Penalty Minutes', '0')) || 0;
        const locked = safeGet(row, 'Locked', 'FALSE') === 'TRUE';

        // Calculate adjusted total (never negative)
        const adjustedTotal = Math.max(0, originalTotal - penalty);

        const teamData = {
          teamCode: teamCode,
          teamName: teamName,
          
          // Score information
          total: originalTotal,
          totalScore: originalTotal, // Legacy field name
          adjustedTotal: adjustedTotal,
          
          // Individual activity scores
          registration: registration,
          clueHunt: clueHunt,
          quiz: quiz,
          kindness: kindness,
          limerick: limerick,
          scavenger: scavenger,
          
          // Penalty information
          penalty: penalty,
          penaltyMinutes: penaltyMinutes,
          status: status,
          returnTime: returnTime,
          locked: locked,
          
          // Status flags
          hasPenalty: penalty > 0,
          isLate: status === 'late',
          hasReturned: status === 'returned' || status === 'late',
          
          // Legacy activity structure
          activities: {
            registration: registration,
            clueHunt: clueHunt,
            clue_hunt: clueHunt, // Alternative naming
            quiz: quiz,
            kindness: kindness,
            limerick: limerick,
            scavenger: scavenger
          },
          
          // Additional legacy fields
          members: row.get('Members') || '',
          registrationTime: row.get('Registration Time') || ''
        };

        teams.push(teamData);

        // Add to leaderboard (teams with >= 0 adjusted points)
        if (adjustedTotal >= 0) {
          leaderboard.push({
            teamCode: teamData.teamCode,
            teamName: teamData.teamName,
            totalScore: adjustedTotal, // Use adjusted total for leaderboard sorting
            total: originalTotal, // Keep original for reference
            adjustedTotal: adjustedTotal,
            penalty: penalty,
            penaltyMinutes: penaltyMinutes,
            status: status,
            returnTime: returnTime,
            locked: locked,
            hasPenalty: penalty > 0,
            isLate: status === 'late',
            hasReturned: status === 'returned' || status === 'late',
            registration: registration,
            clueHunt: clueHunt,
            quiz: quiz,
            kindness: kindness,
            limerick: limerick,
            scavenger: scavenger,
            activities: teamData.activities
          });
        }
      }
    });

    // Sort leaderboard by adjusted total score (descending), then by team name
    leaderboard.sort((a, b) => {
      if (b.adjustedTotal !== a.adjustedTotal) {
        return b.adjustedTotal - a.adjustedTotal;
      }
      return a.teamName.localeCompare(b.teamName);
    });

    // Sort teams array the same way for consistency
    teams.sort((a, b) => {
      if (b.adjustedTotal !== a.adjustedTotal) {
        return b.adjustedTotal - a.adjustedTotal;
      }
      return a.teamName.localeCompare(b.teamName);
    });

    // Add positions to leaderboard
    leaderboard.forEach((team, index) => {
      team.position = index + 1;
    });

    const timestamp = Date.now();
    console.log('Processed', teams.length, 'teams,', leaderboard.length, 'on leaderboard');
    console.log('Teams with penalties:', teams.filter(t => t.hasPenalty).length);
    console.log('Final resultsPublished value being returned:', resultsPublished);

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
        
        // Competition timing info
        competitionStartTime: competitionStartTime,
        competitionDuration: competitionDuration,
        startTime: startTime,
        durationMinutes: durationMinutes,
        
        // Status info
        competitionStatus: competitionStatus,
        status: competitionStatus, // Legacy field name
        resultsPublished: resultsPublished,
        
        timestamp: timestamp,
        debugInfo: {
          teamsCount: teams.length,
          leaderboardCount: leaderboard.length,
          teamsWithPenalties: teams.filter(t => t.hasPenalty).length,
          lateTeams: teams.filter(t => t.isLate).length,
          dataSource: 'Enhanced Leaderboard Sheet with Penalties',
          competitionStatusFromSheet: competitionStatus,
          competitionActive: competitionStartTime ? 'Started' : 'Not Started',
          competitionStartTime: competitionStartTime,
          competitionDuration: competitionDuration,
          resultsPublished: resultsPublished,
          publishedDebug: `Raw published value: ${published}, Type: ${typeof published}, Final result: ${resultsPublished}`,
          penaltySystemActive: true,
          apiCallsUsed: 2,
          sheetsProcessed: ['Competition', 'Leaderboard']
        }
      }),
    };

  } catch (error) {
    console.error('Enhanced leaderboard error:', error);
    
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

// Helper function for safe property access
function safeGet(row, columnName, defaultValue) {
  try {
    const value = row.get(columnName);
    return (value !== undefined && value !== null && value !== '') ? value : defaultValue;
  } catch (error) {
    console.warn(`Warning: Could not read column '${columnName}', using default value:`, defaultValue);
    return defaultValue;
  }
}
