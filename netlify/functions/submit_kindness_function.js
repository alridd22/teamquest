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

    console.log('Sheet ID:', sheetId);
    console.log('API Key present:', !!apiKey);

    if (!sheetId || !apiKey) {
      throw new Error('Missing environment variables');
    }

    console.log('Saving kindness submission to Google Sheets');
    
    // Save submission data to Kindness sheet
    const timestamp = new Date().toISOString();
    const submissionData = [
      [teamCode, teamName, description, location || '', 'Photo uploaded', timestamp, 'Pending AI Score']
    ];

    console.log('Submission data:', submissionData);

    // Try to append to Kindness sheet
    const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Kindness!A:G:append?valueInputOption=RAW&key=${apiKey}`;
    console.log('Google Sheets URL:', appendUrl);
    
    const appendResponse = await fetch(appendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: submissionData
      })
    });

    console.log('Google Sheets response status:', appendResponse.status);
    console.log('Google Sheets response ok:', appendResponse.ok);

    if (appendResponse.ok) {
      const responseData = await appendResponse.json();
      console.log('Google Sheets response data:', responseData);
      console.log('Kindness submission saved to Google Sheets successfully!');
    } else {
      const errorText = await appendResponse.text();
      console.error('Google Sheets error response:', errorText);
      console.log('Could not save to Kindness sheet - API error:', appendResponse.status);
    }

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
