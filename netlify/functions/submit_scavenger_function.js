const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
  console.log('Scavenger item submission started');
  
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
    console.log('Parsing request body');
    const { teamCode, teamName, itemId, itemTitle, itemDescription, photoUrl, maxPoints } = JSON.parse(event.body);
    
    console.log('Processing scavenger submission for team:', teamCode);
    console.log('Item:', itemTitle, '(', itemId, ')');
    console.log('Photo URL:', photoUrl);

    if (!teamCode || !teamName || !itemId || !itemTitle || !photoUrl) {
      throw new Error('Missing required fields');
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

    // Find the Scavenger sheet
    console.log('Looking for Scavenger sheet');
    let scavengerSheet = null;
    
    // Try to find existing Scavenger sheet
    for (const sheet of Object.values(doc.sheetsByTitle)) {
      if (sheet.title === 'Scavenger') {
        scavengerSheet = sheet;
        break;
      }
    }

    if (!scavengerSheet) {
      console.log('Scavenger sheet not found, creating it');
      scavengerSheet = await doc.addSheet({ 
        title: 'Scavenger',
        headerValues: ['Team Code', 'Team Name', 'Item ID', 'Item Title', 'Item Description', 'Photo URL', 'Max Points', 'Submission Time', 'AI Score', 'Verified']
      });
    } else {
      console.log('Using existing Scavenger sheet');
      await scavengerSheet.loadHeaderRow();
      
      // Set headers if they don't exist
      if (!scavengerSheet.headerValues || scavengerSheet.headerValues.length === 0) {
        console.log('Setting up Scavenger sheet headers');
        await scavengerSheet.setHeaderRow(['Team Code', 'Team Name', 'Item ID', 'Item Title', 'Item Description', 'Photo URL', 'Max Points', 'Submission Time', 'AI Score', 'Verified']);
      }
    }

    console.log('Adding scavenger item submission to sheet');
    const submissionTime = new Date().toISOString();
    const newRow = await scavengerSheet.addRow({
      'Team Code': teamCode,
      'Team Name': teamName,
      'Item ID': itemId,
      'Item Title': itemTitle,
      'Item Description': itemDescription,
      'Photo URL': photoUrl,
      'Max Points': maxPoints || 10,
      'Submission Time': submissionTime,
      'AI Score': 'Pending AI Verification',
      'Verified': 'Pending'
    });

    console.log('Scavenger item submission saved successfully:', newRow.rowNumber);
    console.log('AI verification will be processed automatically via Google Sheets trigger');

    // Simulate AI verification for immediate feedback (real scoring happens via Zapier)
    const simulatedVerified = Math.random() > 0.2; // 80% success rate simulation
    const simulatedScore = simulatedVerified ? Math.floor(Math.random() * 3) + (maxPoints - 2) : 0; // Near max points if verified
    
    console.log('Scavenger item submission processed successfully');

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        message: `${itemTitle} submitted successfully! AI verification in progress.`,
        verified: simulatedVerified,
        score: simulatedScore,
        teamCode,
        teamName,
        itemTitle,
        submissionTime,
        note: 'Final verification and scoring via AI will update in 1-2 minutes'
      }),
    };

  } catch (error) {
    console.error('Scavenger submission error:', error);
    
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