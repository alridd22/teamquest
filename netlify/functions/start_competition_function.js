const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
  console.log('Enhanced competition control request started at:', new Date().toISOString());
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

    const { action, customStartTime, teamCode, status, penalty, returnTime, penaltyMinutes, locked } = requestData;
    console.log('Request data:', { action, customStartTime, teamCode, status, penalty });

    // Validate action - enhanced with penalty actions
    const validActions = ['start', 'stop', 'reset', 'publish_results', 'update_team_status', 'toggle_lock'];
    if (!action || !validActions.includes(action)) {
      throw new Error(`Invalid action. Must be one of: ${validActions.join(', ')}`);
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

    // Handle penalty-related actions
    if (action === 'update_team_status' || action === 'toggle_lock') {
      return await handleTeamManagement(doc, action, { teamCode, status, penalty, returnTime, penaltyMinutes, locked });
    }

    // Handle competition control actions (existing logic enhanced)
    return await handleCompetitionControl(doc, action, customStartTime);

  } catch (error) {
    console.error('Enhanced competition control error:', error);
    
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

// Enhanced team management functions
async function handleTeamManagement(doc, action, { teamCode, status, penalty, returnTime, penaltyMinutes, locked }) {
  console.log('Handling team management:', action, 'for team:', teamCode);

  // Get leaderboard sheet
  const leaderboardSheet = doc.sheetsByTitle['Leaderboard'];
  if (!leaderboardSheet) {
    throw new Error('Leaderboard sheet not found');
  }

  // Ensure penalty columns exist
  await ensurePenaltyColumns(leaderboardSheet);
  
  await leaderboardSheet.loadHeaderRow();
  const rows = await leaderboardSheet.getRows();
  
  const teamRow = rows.find(row => row.get('Team Code') === teamCode);
  if (!teamRow) {
    throw new Error(`Team ${teamCode} not found`);
  }

  const now = new Date().toISOString();

  if (action === 'update_team_status') {
    console.log(`Updating team ${teamCode}: status=${status}, penalty=${penalty}`);
    
    // Update team status
    if (status) {
      teamRow.set('Status', status);
    }
    
    // Update penalty information
    if (penalty !== undefined && penalty !== null) {
      teamRow.set('Penalty', penalty.toString());
      teamRow.set('Penalty Minutes', (penaltyMinutes || 0).toString());
    }
    
    // Update return time
    if (returnTime) {
      teamRow.set('Return Time', returnTime);
    }
    
    await teamRow.save();
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        message: `Team ${teamCode} status updated`,
        teamCode,
        status,
        penalty: penalty || 0
      }),
    };
  }

  if (action === 'toggle_lock') {
    console.log(`Toggling lock for team ${teamCode}: ${locked}`);
    
    teamRow.set('Locked', locked ? 'TRUE' : 'FALSE');
    await teamRow.save();
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        message: `Team ${teamCode} lock status updated`,
        teamCode,
        locked
      }),
    };
  }
}

// Original competition control logic (enhanced)
async function handleCompetitionControl(doc, action, customStartTime) {
  // Get or create Competition sheet
  let competitionSheet = doc.sheetsByTitle['Competition'];
  
  if (!competitionSheet) {
    console.log('Competition sheet not found, creating new one...');
    
    // Create new Competition sheet with updated headers
    competitionSheet = await doc.addSheet({
      title: 'Competition',
      headerValues: [
        'Status',                // started, stopped, reset
        'Start Time',            // ISO timestamp when competition started
        'Duration Minutes',      // Competition duration (90)
        'Results Published',     // true/false - whether results are published
        'Published At',          // ISO timestamp when results were published
        'Created At',            // When this record was created
        'Action By',             // Who performed this action
        'Notes'                  // Any additional notes
      ]
    });
    
    console.log('Competition sheet created successfully');
  } else {
    await competitionSheet.loadHeaderRow();
    console.log('Competition sheet loaded successfully');
  }

  // Get current timestamp
  const now = new Date().toISOString();
  
  // Get existing rows to check current state
  const existingRows = await competitionSheet.getRows();
  let currentState = null;
  
  if (existingRows.length > 0) {
    const currentRow = existingRows[0];
    currentState = {
      status: currentRow.get('Status'),
      startTime: currentRow.get('Start Time'),
      duration: currentRow.get('Duration Minutes'),
      resultsPublished: currentRow.get('Results Published') === 'true',
      publishedAt: currentRow.get('Published At')
    };
    console.log('Current competition state:', currentState);
  }

  // Handle different actions
  let newRowData = {};
  let responseMessage = '';
  let responseData = {
    success: true,
    action: action,
    timestamp: now
  };

  if (action === 'publish_results') {
    // Special case: only update the Results Published field
    if (!currentState) {
      throw new Error('No competition found. Please start a competition first.');
    }

    if (currentState.resultsPublished) {
      throw new Error('Results have already been published.');
    }

    // Update existing row to mark results as published
    if (existingRows.length > 0) {
      const currentRow = existingRows[0];
      currentRow.set('Results Published', 'true');
      currentRow.set('Published At', now);
      currentRow.set('Notes', (currentRow.get('Notes') || '') + ` | Results published at ${now}`);
      await currentRow.save();
      
      responseMessage = 'Results published successfully! Leaderboard unfrozen and gallery accessible.';
      responseData.resultsPublished = true;
      responseData.publishedAt = now;
      
      console.log('Results published successfully');
    } else {
      throw new Error('No competition data found to publish results for.');
    }

  } else if (action === 'reset') {
    // Enhanced reset: also reset penalty data
    await resetPenaltyData(doc);
    
    // Delete all existing rows
    for (const row of existingRows) {
      await row.delete();
    }
    
    newRowData = {
      'Status': 'reset',
      'Start Time': '',
      'Duration Minutes': '',
      'Results Published': 'false',
      'Published At': '',
      'Created At': now,
      'Action By': 'Admin',
      'Notes': 'Competition reset via admin panel'
    };

    await competitionSheet.addRow(newRowData);
    responseMessage = 'Competition reset successfully';
    responseData.competitionStartTime = null;
    responseData.resultsPublished = false;

  } else {
    // Handle start, stop actions
    
    // Determine start time for start action
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

    // Delete all existing rows
    for (const row of existingRows) {
      await row.delete();
    }
    
    // FIXED: Preserve start time and duration for 'stop' action
    let preservedStartTime = '';
    let preservedDuration = '';
    
    if (action === 'stop' && currentState) {
      // Preserve the original start time and duration when stopping
      preservedStartTime = currentState.startTime || '';
      preservedDuration = currentState.duration || '';
      console.log('Preserving start time and duration for stop action:', {
        startTime: preservedStartTime,
        duration: preservedDuration
      });
    }
    
    // Create new row data based on action
    newRowData = {
      'Status': action,
      'Start Time': action === 'start' ? startTime : 
                   action === 'stop' ? preservedStartTime : '',  // FIXED: Preserve for stop
      'Duration Minutes': action === 'start' ? 90 : 
                         action === 'stop' ? preservedDuration : '',  // FIXED: Preserve for stop
      'Results Published': 'false',  // Always false for start/stop/reset
      'Published At': '',
      'Created At': now,
      'Action By': 'Admin',
      'Notes': action === 'start' ? 'Competition started via admin panel' : 
               action === 'stop' ? 'Competition stopped via admin panel' :
               'Competition reset via admin panel'
    };

    console.log('Adding new competition status:', newRowData);
    await competitionSheet.addRow(newRowData);

    // Prepare response based on action
    switch (action) {
      case 'start':
        responseMessage = `Competition started successfully at ${startTime}`;
        responseData.competitionStartTime = startTime;
        responseData.duration = 90;
        responseData.resultsPublished = false;
        break;
      case 'stop':
        responseMessage = 'Competition stopped successfully';
        responseData.competitionStartTime = preservedStartTime; // Return preserved time
        responseData.duration = preservedDuration; // Return preserved duration
        responseData.resultsPublished = false;
        break;
    }
  }

  console.log('Competition action completed successfully');

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
}

// Enhanced function to ensure penalty columns exist
async function ensurePenaltyColumns(leaderboardSheet) {
  try {
    await leaderboardSheet.loadHeaderRow();
    console.log('Current headers:', leaderboardSheet.headerValues);
    
    // Check if penalty columns already exist
    const headers = leaderboardSheet.headerValues;
    const requiredColumns = ['Status', 'Penalty', 'Return Time', 'Penalty Minutes', 'Locked'];
    const missingColumns = requiredColumns.filter(col => !headers.includes(col));
    
    if (missingColumns.length > 0) {
      console.log('Adding missing penalty columns:', missingColumns);
      
      // Add missing headers
      const newHeaders = [...headers, ...missingColumns];
      await leaderboardSheet.setHeaderRow(newHeaders);
      
      // Initialize default values for existing teams
      const rows = await leaderboardSheet.getRows();
      console.log('Initializing penalty columns for', rows.length, 'teams');
      
      for (const row of rows) {
        // Set default values for new columns
        if (missingColumns.includes('Status') && !row.get('Status')) {
          row.set('Status', 'active');
        }
        if (missingColumns.includes('Penalty') && !row.get('Penalty')) {
          row.set('Penalty', '0');
        }
        if (missingColumns.includes('Return Time') && !row.get('Return Time')) {
          row.set('Return Time', '');
        }
        if (missingColumns.includes('Penalty Minutes') && !row.get('Penalty Minutes')) {
          row.set('Penalty Minutes', '0');
        }
        if (missingColumns.includes('Locked') && !row.get('Locked')) {
          row.set('Locked', 'FALSE');
        }
        
        await row.save();
      }
      
      console.log('Penalty columns initialized successfully');
    } else {
      console.log('All penalty columns already exist');
    }
  } catch (error) {
    console.error('Error ensuring penalty columns:', error);
    throw error;
  }
}

// Function to reset penalty data
async function resetPenaltyData(doc) {
  try {
    const leaderboardSheet = doc.sheetsByTitle['Leaderboard'];
    if (!leaderboardSheet) return;
    
    await leaderboardSheet.loadHeaderRow();
    const rows = await leaderboardSheet.getRows();
    
    console.log('Resetting penalty data for', rows.length, 'teams');
    
    for (const row of rows) {
      // Reset penalty-related fields
      row.set('Status', 'active');
      row.set('Penalty', '0');
      row.set('Return Time', '');
      row.set('Penalty Minutes', '0');
      row.set('Locked', 'FALSE');
      
      await row.save();
    }
    
    console.log('Penalty data reset successfully');
  } catch (error) {
    console.error('Error resetting penalty data:', error);
    // Don't throw - this is not critical for competition reset
  }
}
