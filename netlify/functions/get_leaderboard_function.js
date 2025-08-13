const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
  console.log('=== SIMPLE TEST FUNCTION STARTED ===');
  console.log('Timestamp:', new Date().toISOString());

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      },
      body: ''
    };
  }

  try {
    console.log('=== CREATING TEST RESPONSE ===');
    
    // Return fake data to test if function is updating
    const testResponse = {
      success: true,
      teams: [
        {
          teamCode: "TEAM-A",
          teamName: "Alex TEST",
          totalScore: 99,
          activities: {
            registration: 10,
            clueHunt: 89,
            quiz: 0,
            kindness: 0,
            limerick: 0,
            scavenger: 0
          }
        },
        {
          teamCode: "TEAM-B", 
          teamName: "Steve TEST",
          totalScore: 88,
          activities: {
            registration: 10,
            clueHunt: 78,
            quiz: 0,
            kindness: 0,
            limerick: 0,
            scavenger: 0
          }
        }
      ],
      leaderboard: [
        {
          teamCode: "TEAM-A",
          teamName: "Alex TEST",
          totalScore: 99,
          registration: 10,
          clueHunt: 89,
          quiz: 0,
          kindness: 0,
          limerick: 0,
          scavenger: 0
        },
        {
          teamCode: "TEAM-B",
          teamName: "Steve TEST", 
          totalScore: 88,
          registration: 10,
          clueHunt: 78,
          quiz: 0,
          kindness: 0,
          limerick: 0,
          scavenger: 0
        }
      ],
      lastUpdated: new Date().toISOString(),
      competitionStartTime: "2025-08-13T10:12:15.351Z",
      timestamp: Date.now(),
      debugInfo: {
        message: "THIS IS A TEST FUNCTION - WORKING!",
        teamsCount: 2,
        dataSource: "Fake Test Data"
      }
    };

    console.log('=== RETURNING TEST RESPONSE ===');
    console.log('Teams count:', testResponse.teams.length);
    console.log('Leaderboard count:', testResponse.leaderboard.length);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testResponse)
    };

  } catch (error) {
    console.error('=== TEST FUNCTION ERROR ===', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
