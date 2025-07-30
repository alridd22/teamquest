const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
  console.log('Quiz submission started');
  
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
    console.log('Parsing quiz submission request body');
    const { 
      teamCode, 
      teamName, 
      totalScore, 
      questionsCorrect, 
      totalQuestions, 
      completionTime, 
      quizStartTime, 
      answers 
    } = JSON.parse(event.body);
    
    console.log('Processing quiz submission for team:', teamCode);
    console.log('Quiz score:', questionsCorrect + '/' + totalQuestions, '(' + totalScore + ' points)');

    if (!teamCode || !teamName || totalScore === undefined || !questionsCorrect === undefined) {
      throw new Error('Missing required quiz submission fields');
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

    // Find or create the Quiz sheet
    console.log('Looking for Quiz sheet');
    let quizSheet = null;
    
    // Try to find existing Quiz sheet
    for (const sheet of Object.values(doc.sheetsByTitle)) {
      if (sheet.title === 'Quiz') {
        quizSheet = sheet;
        break;
      }
    }

    if (!quizSheet) {
      console.log('Quiz sheet not found, creating it with headers');
      quizSheet = await doc.addSheet({ 
        title: 'Quiz',
        headerValues: [
          'Team Code', 'Team Name', 'Total Score', 'Questions Correct', 
          'Total Questions', 'Completion Time', 'Quiz Start Time', 
          'Duration (mins)', 'Percentage', 'Submission Time'
        ]
      });
      console.log('Quiz sheet created successfully');
    } else {
      console.log('Using existing Quiz sheet');
      
      // Load the sheet to check headers
      await quizSheet.loadHeaderRow();
      console.log('Current header values:', quizSheet.headerValues);
      
      // Check if headers exist and are correct
      if (!quizSheet.headerValues || quizSheet.headerValues.length === 0) {
        console.log('No headers found, setting up headers manually');
        
        // Clear the sheet first
        await quizSheet.clear();
        
        // Set headers using updateCells
        await quizSheet.updateCells('A1:J1', [
          [
            'Team Code', 'Team Name', 'Total Score', 'Questions Correct', 
            'Total Questions', 'Completion Time', 'Quiz Start Time', 
            'Duration (mins)', 'Percentage', 'Submission Time'
          ]
        ]);
        
        // Reload to get the headers
        await quizSheet.loadHeaderRow();
        console.log('Headers set manually, new header values:', quizSheet.headerValues);
      }
    }

    // Calculate additional metrics
    const percentage = Math.round((questionsCorrect / totalQuestions) * 100);
    const startTime = new Date(quizStartTime);
    const endTime = new Date(completionTime);
    const durationMins = Math.round((endTime - startTime) / (1000 * 60) * 10) / 10; // Round to 1 decimal
    const submissionTime = new Date().toISOString();

    console.log('Adding quiz submission to sheet');
    console.log('Quiz metrics:', {
      score: totalScore,
      correct: questionsCorrect + '/' + totalQuestions,
      percentage: percentage + '%',
      duration: durationMins + ' mins'
    });
    
    // Add the main quiz record
    const newRow = await quizSheet.addRow({
      'Team Code': teamCode,
      'Team Name': teamName,
      'Total Score': totalScore,
      'Questions Correct': questionsCorrect,
      'Total Questions': totalQuestions,
      'Completion Time': completionTime,
      'Quiz Start Time': quizStartTime,
      'Duration (mins)': durationMins,
      'Percentage': percentage,
      'Submission Time': submissionTime
    });

    console.log('Quiz submission saved successfully to row:', newRow.rowNumber);

    // Optionally save detailed answers to a separate sheet for analysis
    if (answers && answers.length > 0) {
      await saveDetailedAnswers(doc, teamCode, teamName, answers, submissionTime);
    }

    console.log('Quiz submission processed successfully');

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        message: `Quiz completed! ${questionsCorrect}/${totalQuestions} correct (${percentage}%) - ${totalScore} points earned.`,
        teamCode,
        teamName,
        totalScore,
        questionsCorrect,
        totalQuestions,
        percentage,
        duration: durationMins,
        submissionTime
      }),
    };

  } catch (error) {
    console.error('Quiz submission error:', error);
    
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

// Function to save detailed answers for analysis (optional)
async function saveDetailedAnswers(doc, teamCode, teamName, answers, submissionTime) {
  try {
    console.log('Saving detailed quiz answers');
    
    // Find or create Quiz Answers sheet
    let answersSheet = null;
    
    for (const sheet of Object.values(doc.sheetsByTitle)) {
      if (sheet.title === 'Quiz Answers') {
        answersSheet = sheet;
        break;
      }
    }

    if (!answersSheet) {
      console.log('Creating Quiz Answers sheet');
      answersSheet = await doc.addSheet({ 
        title: 'Quiz Answers',
        headerValues: [
          'Team Code', 'Team Name', 'Question ID', 'User Answer', 
          'Correct Answer', 'Is Correct', 'Points', 'Time Left', 'Submission Time'
        ]
      });
    } else {
      await answersSheet.loadHeaderRow();
      
      if (!answersSheet.headerValues || answersSheet.headerValues.length === 0) {
        await answersSheet.clear();
        await answersSheet.updateCells('A1:I1', [
          [
            'Team Code', 'Team Name', 'Question ID', 'User Answer', 
            'Correct Answer', 'Is Correct', 'Points', 'Time Left', 'Submission Time'
          ]
        ]);
        await answersSheet.loadHeaderRow();
      }
    }

    // Add each answer as a separate row
    for (const answer of answers) {
      await answersSheet.addRow({
        'Team Code': teamCode,
        'Team Name': teamName,
        'Question ID': answer.questionId,
        'User Answer': answer.userAnswer || 'No answer',
        'Correct Answer': answer.correctAnswer,
        'Is Correct': answer.isCorrect ? 'TRUE' : 'FALSE',
        'Points': answer.points,
        'Time Left': answer.timeLeft + ' seconds',
        'Submission Time': submissionTime
      });
    }

    console.log('Detailed answers saved successfully');

  } catch (error) {
    console.error('Error saving detailed answers (non-critical):', error);
    // Don't throw - this is optional functionality
  }
}