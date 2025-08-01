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

  try {
    // Get environment variables
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const sheetId = process.env.GOOGLE_SHEET_ID;
    const privateKeyBase64 = process.env.GOOGLE_PRIVATE_KEY_B64;

    console.log('Environment variables check:', {
      hasEmail: !!serviceAccountEmail,
      hasSheetId: !!sheetId,
      hasPrivateKeyB64: !!privateKeyBase64,
    });

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

    // Get activity scores
    const activityScores = {
      kindness: {},
      limerick: {},
      scavenger: {},
      quiz: {}
    };

    // Load Kindness scores
    try {
      const kindnessSheet = doc.sheetsByTitle['Kindness'];
      if (kindnessSheet) {
        await kindnessSheet.loadHeaderRow();
        const kindnessRows = await kindnessSheet.getRows();
        console.log('Kindness rows loaded:', kindnessRows.length);

        kindnessRows.forEach(row => {
          const teamCode = row.get('Team Code');
          const score = parseInt(row.get('AI Score')) || 0;
          
          if (teamCode && score > 0) {
            if (!activityScores.kindness[teamCode]) {
              activityScores.kindness[teamCode] = 0;
            }
            activityScores.kindness[teamCode] += score;
          }
        });
      }
    } catch (error) {
      console.log('Kindness sheet not found or error:', error.message);
    }

    // Load Limerick scores
    try {
      const limerickSheet = doc.sheetsByTitle['Limerick'];
      if (limerickSheet) {
        await limerickSheet.loadHeaderRow();
        const limerickRows = await limerickSheet.getRows();
        console.log('Limerick rows loaded:', limerickRows.length);

        limerickRows.forEach(row => {
          const teamCode = row.get('Team Code');
          const score = parseInt(row.get('AI Score')) || 0;

          if (teamCode && score > 0) {
            if (!activityScores.limerick[teamCode]) {
              activityScores.limerick[teamCode] = 0;
            }
            activityScores.limerick[teamCode] += score;
          }
        });
      }
    } catch (error) {
      console.log('Limerick sheet not found or error:', error.message);
    }

    // Load Scavenger scores
    try {
      const scavengerSheet = doc.sheetsByTitle['Scavenger'];
      if (scavengerSheet) {
        await scavengerSheet.loadHeaderRow();
        const scavengerRows = await scavengerSheet.getRows();
        console.log('Scavenger rows loaded:', scavengerRows.length);

        scavengerRows.forEach(row => {
          const teamCode = row.get('Team Code');
          const score = parseInt(row.get('AI Score')) || 0;

          if (teamCode && score > 0) {
            if (!activityScores.scavenger[teamCode]) {
              activityScores.scavenger[teamCode] = 0;
            }
            activityScores.scavenger[teamCode] += score;
          }
        });
      }
    } catch (error) {
      console.log('Scavenger sheet not found or error:', error.message);
    }

    // Load Quiz scores  
    try {
      const quizSheet = doc.sheetsByTitle['Quiz'];
      if (quizSheet) {
        await quizSheet.loadHeaderRow();
        const quizRows = await quizSheet.getRows();
        console.log('Quiz rows loaded:', quizRows.length);

        quizRows.forEach(row => {
          const teamCode = row.get('Team Code');
          const totalScore = parseInt(row.get('Total Score')) || 0;

          if (teamCode && totalScore > 0) {
            // Quiz scores are final - no verification needed
            activityScores.quiz[teamCode] = totalScore;
          }
        });
      }
    } catch (error) {
      console.log('Quiz sheet not found or error:', error.message);
    }

    console.log('Activity scores loaded:', activityScores);

    // Get all teams from registration sheet
    let allTeams = [];
    try {
      const registrationSheet = doc.sheetsByTitle['Team Registration'];
      if (registrationSheet) {
        await registrationSheet.loadHeaderRow();
        const teamRows = await registrationSheet.getRows();
        console.log('Team registration rows loaded:', teamRows.length);
        console.log('Sample team row headers:', registrationSheet.headerValues);

        allTeams = teamRows.map(row => ({
          teamCode: row.get('Team Code'),
          teamName: row.get('Team Name'),
          members: row.get('Team Members') || '',
          registrationTime: row.get('Registration Time') || ''
        })).filter(team => team.teamCode && team.teamName);
        
        console.log('Processed teams:', allTeams);
      }
    } catch (error) {
      console.log('Team registration sheet not found:', error.message);
      // Use teams from activity data instead of hardcoded fallback
      const allTeamCodes = new Set([
        ...Object.keys(activityScores.kindness),
        ...Object.keys(activityScores.limerick),
        ...Object.keys(activityScores.scavenger),
        ...Object.keys(activityScores.quiz)
      ]);
      
      console.log('Team codes from activities:', [...allTeamCodes]);
      
      allTeams = [...allTeamCodes].map(teamCode => ({
        teamCode,
        teamName: teamCode, // Use team code as name for now
        members: '',
        registrationTime: ''
      }));
      
      console.log('Fallback teams created:', allTeams);
    }

    // Calculate leaderboard
    const leaderboard = allTeams.map(team => {
      // Get scores (defaulting to 0 if not found)
      const registration = 10; // Fixed registration score
      const clueHunt = 0; // Not implemented yet
      const kindness = activityScores.kindness[team.teamCode] || 0;
      const scavenger = activityScores.scavenger[team.teamCode] || 0;
      const limerick = activityScores.limerick[team.teamCode] || 0;
      const quiz = activityScores.quiz[team.teamCode] || 0;

      const totalScore = registration + clueHunt + kindness + scavenger + limerick + quiz;

      return {
        teamCode: team.teamCode,
        teamName: team.teamName,
        totalScore,
        activities: {
          registration,
          clueHunt,
          quiz,
          kindness,
          scavenger,
          limerick
        },
        members: team.members,
        registrationTime: team.registrationTime
      };
    });

    // Sort by total score (descending)
    leaderboard.sort((a, b) => b.totalScore - a.totalScore);

    console.log('Leaderboard calculated:', leaderboard.map(team => 
      `${team.teamName}: ${team.totalScore} points`
    ));

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        teams: allTeams,
        leaderboard,
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
