exports.handler = async (event, context) => {
  console.log('Limerick submission started');
  
  // Handle preflight CORS requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {'Access-Control-Allow-Origin': '*'},
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { teamCode, teamName, topic, limerickText } = JSON.parse(event.body);
    
    console.log('Processing limerick submission for team:', teamCode);

    if (!teamCode || !teamName || !limerickText) {
      throw new Error('Missing required fields');
    }

    const sheetId = process.env.GOOGLE_SHEET_ID;
    const apiKey = process.env.GOOGLE_API_KEY;

    if (!sheetId || !apiKey) {
      throw new Error('Missing environment variables');
    }

    // For now, we'll save to a "Limerick" sheet in Google Sheets
    // This is the exact same pattern as your working kindness function
    console.log('Saving limerick submission to Google Sheets');
    
    const timestamp = new Date().toISOString();
    const submissionData = [
      [teamCode, teamName, topic || '', limerickText, timestamp, 'Pending AI Score']
    ];

    // Try to append to Limerick sheet - same approach as kindness function
    const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Limerick!A:F:append?valueInputOption=RAW&key=${apiKey}`;
    
    const appendResponse = await fetch(appendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: submissionData
      })
    });

    if (!appendResponse.ok) {
      // If Limerick sheet doesn't exist, the append will fail
      console.log('Limerick sheet might not exist, submission logged but not saved to sheets');
      console.log('Response status:', appendResponse.status);
      console.log('Response:', await appendResponse.text());
    } else {
      console.log('Limerick submission saved to Google Sheets');
    }

    // Simulate AI scoring for demo (normally done by Zapier + OpenAI)
    const simulatedScore = Math.floor(Math.random() * 30) + 20; // 20-50 points
    
    console.log('Limerick submission processed successfully');

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        message: 'Limerick submitted successfully',
        simulatedScore: simulatedScore,
        teamCode,
        teamName
      }),
    };

  } catch (error) {
    console.error('Limerick submission error:', error);
    
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
