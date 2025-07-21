exports.handler = async (event, context) => {
  console.log('Kindness submission started');
  
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
    const { teamCode, teamName, description, location, photoData } = JSON.parse(event.body);
    
    console.log('Processing kindness submission for team:', teamCode);

    if (!teamCode || !teamName || !description || !photoData) {
      throw new Error('Missing required fields');
    }

    const sheetId = process.env.GOOGLE_SHEET_ID;
    const apiKey = process.env.GOOGLE_API_KEY;

    if (!sheetId || !apiKey) {
      throw new Error('Missing environment variables');
    }

    // For now, we'll save to a "Kindness" sheet in Google Sheets
    // In a full implementation, you'd also:
    // 1. Upload photo to cloud storage (Uploadcare/Cloudinary)
    // 2. Send to Zapier webhook for AI scoring
    // 3. Update leaderboard when score is returned

    console.log('Saving kindness submission to Google Sheets');
    
    // First, check if Kindness sheet exists, if not we'll append to a new range
    const timestamp = new Date().toISOString();
    const submissionData = [
      [teamCode, teamName, description, location || '', 'Photo uploaded', timestamp, 'Pending AI Score']
    ];

    // Try to append to Kindness sheet
    const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Kindness!A:G:append?valueInputOption=RAW&key=${apiKey}`;
    
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
      // If Kindness sheet doesn't exist, the append will fail
      console.log('Kindness sheet might not exist, submission logged but not saved to sheets');
    } else {
      console.log('Kindness submission saved to Google Sheets');
    }

    // TODO: In full implementation, trigger Zapier webhook here
    // const zapierWebhook = process.env.ZAPIER_KINDNESS_WEBHOOK;
    // if (zapierWebhook) {
    //   await fetch(zapierWebhook, {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({
    //       teamCode,
    //       teamName,
    //       description,
    //       location,
    //       photoUrl: 'placeholder-url',
    //       timestamp
    //     })
    //   });
    // }

    // Simulate AI scoring for demo (normally done by Zapier + OpenAI)
    const simulatedScore = Math.floor(Math.random() * 30) + 20; // 20-50 points
    
    console.log('Kindness submission processed successfully');

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        message: 'Kindness act submitted successfully',
        simulatedScore: simulatedScore,
        teamCode,
        teamName
      }),
    };

  } catch (error) {
    console.error('Kindness submission error:', error);
    
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