const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
    console.log('Check Quiz Status request started at:', new Date().toISOString());

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
        console.log('Check Quiz Status Request:', requestBody);

        const { teamCode } = requestBody;

        if (!teamCode) {
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    success: false, 
                    error: 'Missing required field: teamCode' 
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
                // If Quiz sheet doesn't exist, quiz hasn't been started
                console.log('Quiz sheet not found - treating as not started');
                return {
                    statusCode: 200,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ 
                        success: true,
                        started: false,
                        completed: false,
                        message: 'Quiz sheet not found - quiz not started'
                    })
                };
            }
        } catch (error) {
            console.error('Quiz sheet access error:', error);
            // If we can't access the sheet, assume quiz not started
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    success: true,
                    started: false,
                    completed: false,
                    message: 'Quiz sheet access error - treating as not started'
                })
            };
        }

        // Load existing rows
        await quizSheet.loadHeaderRow();
        const rows = await quizSheet.getRows();

        console.log('Checking quiz status for team:', teamCode);

        // Find team's quiz record
        const teamRow = rows.find(row => row.get('Team Code') === teamCode);

        if (!teamRow) {
            // No record found - quiz not started
            console.log('No quiz record found for team:', teamCode);
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    success: true,
                    started: false,
                    completed: false,
                    message: 'No quiz record found'
                })
            };
        }

        // Check status based on fields
        const hasStartTime = teamRow.get('Quiz Start Time') && teamRow.get('Quiz Start Time').trim() !== '';
        const hasCompletionTime = teamRow.get('Completion Time') && teamRow.get('Completion Time').trim() !== '';
        
        console.log('Quiz status for team', teamCode, ':', {
            hasStartTime,
            hasCompletionTime,
            startTime: teamRow.get('Quiz Start Time'),
            completionTime: teamRow.get('Completion Time')
        });

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                success: true,
                started: hasStartTime,
                completed: hasCompletionTime,
                teamCode: teamCode,
                quizStartTime: hasStartTime ? teamRow.get('Quiz Start Time') : null,
                completionTime: hasCompletionTime ? teamRow.get('Completion Time') : null,
                totalScore: hasCompletionTime ? (teamRow.get('Total Score') || '0') : null
            })
        };

    } catch (error) {
        console.error('Check Quiz Status Function Error:', error);
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
