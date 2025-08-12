const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
  console.log('Start competition request started at:', new Date().toISOString());
  console.log('HTTP Method:', event.httpMethod);
  console.log('Request body:', event.body);

  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
      body: '',
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: false,
        error: 'Method not allowed. Use POST.',
      }),
    };
  }

  try {
    // Parse request body
    let requestData;
    try {
      requestData = JSON.parse(event.body || '{}');
    } catch (parseError) {
      throw new Error('Invalid JSON in request body');
    }

    const { action, customStartTime } = requestData;
    console.log('Request data:', { action, customStartTime });

    // Validate action
    if (!action || !['start', 'stop', 'reset'].includes(action)) {
      throw new Error('Invalid action. Must be "start", "stop", or "reset".');
    }

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

    // Get or create Competition sheet
    let competitionSheet = doc.sheetsByTitle['Competition'];
    
    if (!competitionSheet) {
      console.log('Competition sheet not found, creating new one...');
      
      // Create new Competition sheet
      competitionSheet = await doc.addSheet({
        title: 'Competition',
        headerValues: [
          'Status',           // started, stopped, reset
          'Start Time',       // ISO timestamp when competition started
          'Duration Minutes', // Competition duration (90)
          'Created At',       // When this record was created
          'Action By',        // Who performed this action (could be admin identifier)
          'Notes'            // Any additional notes
        ]
      });
      
      console.log('Competition sheet created successfully');
    } else {
      await competitionSheet.loadHeaderRow();
      console.log('Competition sheet loaded successfully');
    }

    // Get current timestamp
    const now = new Date().toISOString();
    
    // Determine start time
    let startTime;
    if (action === 'start') {
      startTime = customStartTime || now;
      
      // Validate custom start time if provided
      if (customStartTime) {
        const customDate = new Date(customStartTime);
        if (isNaN(customDate.getTime())) {
          throw new Error('Invalid custom start time format. Use ISO format (e.g., 2025-01-01T10:00:00Z)');
        }
        startTime = customDate.toISOString();
      }
    }

    // Clear existing rows and add new competition status
    const existingRows = await competitionSheet.getRows();
    
    // Delete all existing rows
    for (const row of existingRows) {
      await row.delete();
    }
    
    // Add new status row
    const newRowData = {
      'Status': action,
      'Start Time': action === 'start' ? startTime : '',
      'Duration Minutes': action === 'start' ? 90 : '',
      'Created At': now,
      'Action By': 'Admin',
      'Notes': action === 'start' ? 'Competition started via admin panel' : 
               action === 'stop' ? 'Competition stopped via admin panel' :
               'Competition reset via admin panel'
    };

    console.log('Adding new competition status:', newRowData);
    
    await competitionSheet.addRow(newRowData);
    
    console.log('Competition status updated successfully');

    // Prepare response
    let responseMessage;
    let responseData = {
      success: true,
      action: action,
      timestamp: now
    };

    switch (action) {
      case 'start':
        responseMessage = `Competition started successfully at ${startTime}`;
        responseData.competitionStartTime = startTime;
        responseData.duration = 90;
        break;
      case 'stop':
        responseMessage = 'Competition stopped successfully';
        responseData.competitionStartTime = null;
        break;
      case 'reset':
        responseMessage = 'Competition reset successfully';
        responseData.competitionStartTime = null;
        break;
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
      body: JSON.stringify({
        ...responseData,
        message: responseMessage
      }),
    };

  } catch (error) {
    console.error('Start competition error:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
      body: JSON.stringify({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }),
    };
  }
};