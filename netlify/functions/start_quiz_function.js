const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
    console.log('Start Quiz request started at:', new Date().toISOString());

    // Handle CORS
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: JSON.stringify({ message: 'CORS preflight successful' })
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const requestBody = JSON.parse(event.body);
        console.log('Start Quiz Request:', requestBody);

        const { teamCode, teamName, quizStartTime } = requestBody;

        if (!teamCode || !teamName || !quizStartTime) {
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    success: false, 
                    error: 'Missing required fields: teamCode, teamName, quizStartTime' 
                })
            };
        }

        // Get environment variables (EXACT SAME as your working functions)
        const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        const sheetId = process.env.GOOGLE_SHEET_ID;
        const privateKeyBase64 = process.env.GOOGLE_PRIVATE_KEY_B64;

        if (!serviceAccountEmail || !privateKeyBase64 || !sheetId) {
            throw new Error('Missing required environment variables');
        }

        // Decode private key (EXACT SAME as your working functions)
        let privateKey = Buffer.from(privateKeyBase64, 'base64').toString('utf8');
        if (privateKey.includes('\\n')) {
            privateKey = privateKey.replace(/\\n/g, '\n');
        }

        // Create JWT client (EXACT SAME as your working functions)
        const serviceAccountAuth = new JWT({
            email: serviceAccountEmail,
            key: privateKey,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        // Initialize Google Sheet (EXACT SAME as your working functions)
        const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await doc.loadInfo();
        console.log('Sheet loaded successfully:', doc.title);

        // Access the Quiz sheet
        let quizSheet;
        try {
            quizSheet = doc.sheetsByTitle['Quiz'];
            if (!quizSheet) {
                throw new Error('Quiz sheet not found');
            }
        } catch (error) {
            console.error('Quiz sheet access error:', error);
            return {
                statusCode: 500,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    success: false, 
                    error: 'Quiz sheet not found. Please ensure the Quiz sheet exists in your Google Spreadsheet.' 
                })
            };
        }

        // Load existing rows to check for duplicates
        await quizSheet.loadHeaderRow();
        const rows = await quizSheet.getRows();

        console.log('Checking for existing quiz record for team:', teamCode);

        // Check if team has already started quiz
        const existingRow = rows.find(row => row.get('Team Code') === teamCode);

        if (existingRow && existingRow.get('Quiz Start Time')) {
            console.log('Team has already started quiz:', teamCode);
            return {
                statusCode: 409, // Conflict
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    success: false, 
                    error: 'Quiz already started',
                    message: 'This team has already started the quiz trial'
                })
            };
        }

        // Record quiz start
        if (existingRow) {
            // Update existing row with start time
            existingRow.set('Quiz Start Time', quizStartTime);
            existingRow.set('Team Name', teamName); // Ensure team name is set
            await existingRow.save();
            console.log('Updated existing row with quiz start time');
        } else {
            // Create new row for quiz start
            const newRow = await quizSheet.addRow({
                'Team Code': teamCode,
                'Team Name': teamName,
                'Total Score': '', // Will be filled when quiz completes
                'Questions Correct': '',
                'Total Questions': '',
                'Completion Time': '',
                'Quiz Start Time': quizStartTime,
                'Duration (mins)': '',
                'Percentage': '',
                'Submission Time': ''
            });
            console.log('Created new row with quiz start time');
        }

        console.log('Quiz start recorded successfully for team:', teamCode);

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                success: true,
                message: 'Quiz start recorded successfully',
                teamCode: teamCode,
                startTime: quizStartTime
            })
        };

    } catch (error) {
        console.error('Start Quiz Function Error:', error);
        console.error('Error stack:', error.stack);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                success: false, 
                error: 'Internal server error',
                details: error.message
            })
        };
    }
};
