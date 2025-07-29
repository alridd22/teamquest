exports.handler = async (event, context) => {
  console.log('Simple leaderboard request started');

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
    // For now, return sample data that matches what your backend logs showed
    // This will at least get the leaderboard displaying while we fix the real data loading
    
    const sampleTeams = [
      {
        rank: 1,
        teamCode: 'TEAM-C',
        teamName: 'The Clue Hunters',
        registration: 10,
        clueHunt: 0,
        quiz: 0,
        kindness: 134,
        scavenger: 0,
        limerick: 45,
        totalScore: 189
      },
      {
        rank: 2,
        teamCode: 'TEAM-H',
        teamName: 'AaronTeam',
        registration: 10,
        clueHunt: 0,
        quiz: 0,
        kindness: 39,
        scavenger: 0,
        limerick: 0,
        totalScore: 49
      },
      {
        rank: 3,
        teamCode: 'TEAM-I',
        teamName: 'AaronTeam2',
        registration: 10,
        clueHunt: 0,
        quiz: 0,
        kindness: 38,
        scavenger: 0,
        limerick: 0,
        totalScore: 48
      },
      {
        rank: 4,
        teamCode: 'TEAM-D',
        teamName: 'Pheebs the Gr8',
        registration: 10,
        clueHunt: 0,
        quiz: 0,
        kindness: 27,
        scavenger: 0,
        limerick: 0,
        totalScore: 37
      }
    ];

    console.log('Returning sample leaderboard data');

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        teams: sampleTeams,
        lastUpdated: new Date().toISOString(),
        note: 'Sample data based on backend logs - replace with real function once dependencies fixed'
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
