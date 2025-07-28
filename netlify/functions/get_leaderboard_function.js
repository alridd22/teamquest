const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

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

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: {'Access-Control-Allow-Origin': '*'},
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    console.log('Setting up Google Sheets authentication');

    // Get environment variables (same as working functions)
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const privateKeyBase64 = process.env.GOOGLE_PRIVATE_KEY_B64;

    if (!serviceAccountEmail || !privateKeyBase64 || !sheetId) {
      throw new Error('Missing required environment variables');
    }

    // Decode private key from base64 (same as working functions)
    let privateKey = Buffer.from(privateKeyBase64, 'base64').toString('utf8');
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    // Create JWT authentication
    const serviceAccountAuth = new JWT({
      email: serviceAccountEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    // Initialize the sheet
    const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    await doc.loadInfo();
    console.log('Google Sheet loaded:', doc.title);

    // Get the main leaderboard/registration sheet (first sheet)
    const mainSheet = doc.sheetsByIndex[0];
    await mainSheet.loadHeaderRow();
    const mainRows = await mainSheet.getRows();
    console.log(`Found ${mainRows.length} teams in main sheet`);

    // Get activity scores
    const activityScores = {
      kindness: {},
      limerick: {}
    };

    // Load Kindness scores
    try {
      const kindnessSheet = doc.sheetsByTitle['Kindness'];
      if (kindnessSheet) {
        await kindnessSheet.loadHeaderRow();
        const kindnessRows = await kindnessSheet.getRows();
        
        kindnessRows.forEach(row => {
          const teamCode = row.get('Team Code');
          const score = row.get('AI Score');
          
          if (teamCode && score && !isNaN(parseFloat(score))) {
            if (!activityScores.kindness[teamCode]) {
              activityScores.kindness[teamCode] = 0;
            }
            activityScores.kindness[teamCode] += parseFloat(score);
          }
        });
        
        console.log('Kindness scores loaded:', activityScores.kindness);
      }
    } catch (error) {
      console.log('Could not load Kindness sheet:', error.message);
    }

    // Load Limerick scores
    try {
      const limerickSheet = doc.sheetsByTitle['Limerick'];
      if (limerickSheet) {
        await limerickSheet.loadHeaderRow();
        const limerickRows = await limerickSheet.getRows();
        
        limerickRows.forEach(row => {
          const teamCode = row.get('Team Code');
          const score = row.get('AI Score');
          
          if (teamCode && score && !isNaN(parseFloat(score))) {
            if (!activityScores.limerick[teamCode]) {
              activityScores.limerick[teamCode] = 0;
            }
            activityScores.limerick[teamCode] += parseFloat(score);
          }
        });
        
        console.log('Limerick scores loaded:', activityScores.limerick);
      }
    } catch (error) {
      console.log('Could not load Limerick sheet:', error.message);
    }

    // Process teams data
    const teams = [];
    
    mainRows.forEach(row => {
      try {
        const teamCode = row.get('Team Code') || row.get('teamCode') || '';
        const teamName = row.get('Team Name') || row.get('teamName') || '';
        
        if (!teamCode || !teamName) {
          return; // Skip invalid rows
        }

        // Get scores (defaulting to 0 if not found)
        const registration = 10; // Fixed registration score
        const clueHunt = 0; // Not implemented yet
        const quiz = 0; // Not implemented yet
        const kindness = activityScores.kindness[teamCode] || 0;
        const scavenger = 0; // Not implemented yet
        const limerick = activityScores.limerick[teamCode] || 0;

        const totalScore = registration + clueHunt + quiz + kindness + scavenger + limerick;

        teams.push({
          teamCode,
          teamName,
          registration,
          clueHunt,
          quiz,
          kindness,
          scavenger,
          limerick,
          totalScore
        });
      } catch (rowError) {
        console.log('Error processing row:', rowError.message);
      }
    });

    // Sort by total score (highest first)
    teams.sort((a, b) => b.totalScore - a.totalScore);

    // Add rank to each team
    teams.forEach((team, index) => {
      team.rank = index + 1;
    });

    console.log(`Processed ${teams.length} teams with activity scores integrated`);

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
