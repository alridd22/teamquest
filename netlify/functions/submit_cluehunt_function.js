const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
  console.log('Clue Hunt submission started');
  
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
    console.log('Parsing clue hunt submission request body');
    const { 
      teamCode, 
      teamName, 
      clueId, 
      clueText, 
      userAnswer, 
      correctAnswer, 
      points, 
      currentScore 
    } = JSON.parse(event.body);
    
    console.log('Processing clue hunt submission for team:', teamCode);
    console.log('Clue:', clueId, '-', clueText);
    console.log('Answer:', userAnswer, '(correct:', correctAnswer, ')');
    console.log('Points earned:', points);

    if (!teamCode || !teamName || !clueId || !userAnswer || !points === undefined) {
      throw new Error('Missing required clue hunt submission fields');
    }

    // Get environment variables (same as working functions)
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

    // Decode private key from base64 (same as working functions)
    console.log('Decoding GOOGLE_PRIVATE_KEY_B64');
    let privateKey = Buffer.from(privateKeyBase64, 'base64').toString('utf8');

    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      throw new Error('Private key format invalid – missing BEGIN header');
    }

    console.log('Private key successfully decoded, length:', privateKey.length);

    // Create JWT client (same as working functions)
    console.log('Creating JWT client');
    const serviceAccountAuth = new JWT({
      email: serviceAccountEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    // Initialize Google Sheet (same as working functions)
    console.log('Initializing Google Sheet');
    const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);

    try {
      await doc.loadInfo();
      console.log('Sheet loaded successfully:', doc.title);
    } catch (loadError) {
      console.error('Sheet load failed:', loadError.message);
      throw new Error(`Sheet access failed: ${loadError.message}`);
    }

    // Find or create the Clue Hunt sheet
    console.log('Looking for Clue Hunt sheet');
    let clueHuntSheet = null;
    
    // Try to find existing Clue Hunt sheet
    for (const sheet of Object.values(doc.sheetsByTitle)) {
      if (sheet.title === 'Clue Hunt') {
        clueHuntSheet = sheet;
        break;
      }
    }

    if (!clueHuntSheet) {
      console.log('Clue Hunt sheet not found, creating it with headers');
      clueHuntSheet = await doc.addSheet({ 
        title: 'Clue Hunt',
        headerValues: [
          'Team Code', 'Team Name', 'Clue ID', 'Clue Text', 'User Answer', 
          'Correct Answer', 'Points', 'Current Score', 'Submission Time'
        ]
      });
      console.log('Clue Hunt sheet created successfully');
    } else {
      console.log('Using existing Clue Hunt sheet');
      
      // Load the sheet to check headers
      await clueHuntSheet.loadHeaderRow();
      console.log('Current header values:', clueHuntSheet.headerValues);
      
      // Check if headers exist and are correct
      if (!clueHuntSheet.headerValues || clueHuntSheet.headerValues.length === 0) {
        console.log('No headers found, setting up headers manually');
        
        // Clear the sheet first
        await clueHuntSheet.clear();
        
        // Set headers using updateCells
        await clueHuntSheet.updateCells('A1:I1', [
          [
            'Team Code', 'Team Name', 'Clue ID', 'Clue Text', 'User Answer', 
            'Correct Answer', 'Points', 'Current Score', 'Submission Time'
          ]
        ]);
        
        // Reload to get the headers
        await clueHuntSheet.loadHeaderRow();
        console.log('Headers set manually, new header values:', clueHuntSheet.headerValues);
      }
    }

    // Check if this clue has already been submitted by this team
    await clueHuntSheet.loadHeaderRow();
    const existingRows = await clueHuntSheet.getRows();
    const existingSubmission = existingRows.find(row => 
      row.get('Team Code') === teamCode && row.get('Clue ID') == clueId
    );

    if (existingSubmission) {
      console.log('Clue already submitted by this team, skipping duplicate');
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          success: true,
          message: 'Clue already completed',
          duplicate: true,
          teamCode,
          clueId,
          points
        }),
      };
    }

    const submissionTime = new Date().toISOString();

    console.log('Adding clue hunt submission to sheet');
    console.log('Submission details:', {
      teamCode,
      teamName,
      clueId,
      points,
      currentScore
    });
    
    // Add the clue submission
    const newRow = await clueHuntSheet.addRow({
      'Team Code': teamCode,
      'Team Name': teamName,
      'Clue ID': clueId,
      'Clue Text': clueText,
      'User Answer': userAnswer,
      'Correct Answer': correctAnswer,
      'Points': points,
      'Current Score': currentScore,
      'Submission Time': submissionTime
    });

    console.log('Clue hunt submission saved successfully to row:', newRow.rowNumber);
    console.log('Clue hunt submission processed successfully');

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        message: `Clue ${clueId} completed! ${points} points earned.`,
        teamCode,
        teamName,
        clueId,
        points,
        currentScore,
        submissionTime
      }),
    };

  } catch (error) {
    console.error('Clue hunt submission error:', error);
    
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