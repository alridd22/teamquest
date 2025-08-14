const { GoogleSpreadsheet } = require('google-spreadsheet');

exports.handler = async (event, context) => {
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

        // Initialize Google Sheets using the same method as your existing functions
        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
        
        // Use API key authentication (same as your existing functions)
        doc.useApiKey(process.env.GOOGLE_API_KEY);
        
        await doc.loadInfo();
        console.log('Google Sheets connected successfully using API key');

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
        const teamRow = rows.find(row => row['Team Code'] === teamCode);

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
        const hasStartTime = teamRow['Quiz Start Time'] && teamRow['Quiz Start Time'].trim() !== '';
        const hasCompletionTime = teamRow['Completion Time'] && teamRow['Completion Time'].trim() !== '';
        
        console.log('Quiz status for team', teamCode, ':', {
            hasStartTime,
            hasCompletionTime,
            startTime: teamRow['Quiz Start Time'],
            completionTime: teamRow['Completion Time']
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
                quizStartTime: hasStartTime ? teamRow['Quiz Start Time'] : null,
                completionTime: hasCompletionTime ? teamRow['Completion Time'] : null,
                totalScore: hasCompletionTime ? (teamRow['Total Score'] || '0') : null
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
