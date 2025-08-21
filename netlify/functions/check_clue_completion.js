// /.netlify/functions/check-clue-completion.js
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// Initialize Google Sheets authentication
async function initializeGoogleSheet() {
    try {
        // Parse service account credentials
        const serviceAccountAuth = new JWT({
            email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        // Initialize the sheet
        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
        await doc.loadInfo();
        
        return doc;
    } catch (error) {
        console.error('Google Sheets initialization error:', error);
        throw new Error('Failed to initialize Google Sheets connection');
    }
}

exports.handler = async (event, context) => {
    // Set CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle preflight OPTIONS request
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        // Parse request body
        let requestData;
        try {
            requestData = JSON.parse(event.body);
        } catch (parseError) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Invalid JSON in request body' })
            };
        }

        const { teamCode } = requestData;

        // Validate required fields
        if (!teamCode) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'teamCode is required' })
            };
        }

        console.log('Checking completion status for team:', teamCode);

        // Check required environment variables
        if (!process.env.GOOGLE_SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
            throw new Error('Missing required Google Sheets environment variables');
        }

        // Initialize Google Sheets
        const doc = await initializeGoogleSheet();
        console.log('Connected to spreadsheet:', doc.title);

        // Get the Clue Hunt sheet
        let clueHuntSheet;
        try {
            clueHuntSheet = doc.sheetsByTitle['Clue Hunt'];
            if (!clueHuntSheet) {
                // Try alternative sheet names
                clueHuntSheet = doc.sheetsByTitle['CluHunt'] || doc.sheetsByTitle['clue_hunt'];
            }
            
            if (!clueHuntSheet) {
                throw new Error('Clue Hunt sheet not found');
            }
        } catch (sheetError) {
            console.error('Sheet access error:', sheetError);
            throw new Error('Could not access Clue Hunt sheet');
        }

        // Load all rows from the sheet
        const rows = await clueHuntSheet.getRows();
        console.log('Found', rows.length, 'total rows in Clue Hunt sheet');

        // Filter rows for this specific team
        const teamSubmissions = rows.filter(row => {
            // Handle different possible column names for team code
            const teamCodeValue = row.get('Team Code') || row.get('TeamCode') || row.get('team_code') || 
                                 row.get('A') || row._rawData[0];
            
            return teamCodeValue && teamCodeValue.toString().trim() === teamCode.toString().trim();
        });

        console.log('Found', teamSubmissions.length, 'submissions for team', teamCode);

        // Calculate total score and correct answers for this team
        let totalScore = 0;
        let correctAnswers = 0;

        teamSubmissions.forEach(row => {
            // Handle different possible column names for points/score
            const points = parseInt(
                row.get('Points') || row.get('Score') || row.get('points') || 
                row.get('G') || row._rawData[6] || 0
            );
            
            totalScore += points;
            
            // Count correct answers (non-zero points)
            if (points > 0) {
                correctAnswers++;
            }
        });

        // Determine if quest is complete
        const totalClues = 20;
        const isCompleted = teamSubmissions.length >= totalClues;

        console.log('Completion check results:', {
            teamCode,
            totalSubmissions: teamSubmissions.length,
            totalClues,
            isCompleted,
            totalScore,
            correctAnswers
        });

        // Return completion status
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                completed: isCompleted,
                cluesAttempted: teamSubmissions.length,
                cluesCorrect: correctAnswers,
                totalClues: totalClues,
                totalScore: totalScore,
                progress: {
                    attempted: teamSubmissions.length,
                    correct: correctAnswers,
                    total: totalClues,
                    percentage: Math.round((teamSubmissions.length / totalClues) * 100)
                }
            })
        };

    } catch (error) {
        console.error('Error checking clue hunt completion:', error);
        
        // Return appropriate error response
        let statusCode = 500;
        let errorMessage = 'Internal server error checking completion status';

        // Handle specific error types
        if (error.message.includes('not found')) {
            statusCode = 404;
            errorMessage = 'Sheet not found or inaccessible';
        } else if (error.message.includes('permission') || error.message.includes('403')) {
            statusCode = 403;
            errorMessage = 'Permission denied accessing spreadsheet';
        } else if (error.message.includes('Missing required')) {
            statusCode = 500;
            errorMessage = 'Server configuration error';
        }

        return {
            statusCode,
            headers,
            body: JSON.stringify({ 
                success: false,
                error: errorMessage,
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            })
        };
    }
};