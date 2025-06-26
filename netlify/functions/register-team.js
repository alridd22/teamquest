// netlify/functions/register-team.js
// Handles team registration submissions

const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// Environment variables you'll need to set in Netlify:
// GOOGLE_SERVICE_ACCOUNT_EMAIL
// GOOGLE_PRIVATE_KEY
// GOOGLE_SHEET_ID

exports.handler = async (event, context) => {
    // Set CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle preflight requests
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
            body: JSON.stringify({ 
                success: false, 
                message: 'Method not allowed' 
            })
        };
    }

    try {
        // Parse request body
        const { teamCode, teamName } = JSON.parse(event.body);

        // Validate input
        if (!teamCode || !teamName) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    success: false,
                    message: 'Team code and team name are required'
                })
            };
        }

        // Validate team name
        if (teamName.length < 2 || teamName.length > 50) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({
                    success: false,
                    message: 'Team name must be between 2 and 50 characters'
                })
            };
        }

        // Initialize Google Sheets
        const serviceAccountAuth = new JWT({
            email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);
        await doc.loadInfo();

        // Get or create the Teams sheet
        let sheet = doc.sheetsByTitle['Teams'];
        if (!sheet) {
            sheet = await doc.addSheet({
                title: 'Teams',
                headerValues: [
                    'Team Code',
                    'Team Name', 
                    'Registration Time',
                    'Status'
                ]
            });
        }

        // Load existing rows to check for duplicates
        await sheet.loadHeaderRow();
        const rows = await sheet.getRows();

        // Check for duplicate team code
        const existingTeam = rows.find(row => row.get('Team Code') === teamCode);
        if (existingTeam) {
            return {
                statusCode: 409,
                headers,
                body: JSON.stringify({
                    success: false,
                    message: `Team code ${teamCode} is already registered as "${existingTeam.get('Team Name')}"`
                })
            };
        }

        // Check for duplicate team name
        const existingName = rows.find(row => 
            row.get('Team Name').toLowerCase() === teamName.toLowerCase()
        );
        if (existingName) {
            return {
                statusCode: 409,
                headers,
                body: JSON.stringify({
                    success: false,
                    message: `Team name "${teamName}" is already taken`
                })
            };
        }

        // Add new team
        await sheet.addRow({
            'Team Code': teamCode,
            'Team Name': teamName,
            'Registration Time': new Date().toISOString(),
            'Status': 'Registered'
        });

        // Initialize leaderboard entry
        await initializeLeaderboard(doc, teamCode, teamName);

        console.log(`Team registered successfully: ${teamCode} - ${teamName}`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                success: true,
                message: 'Team registered successfully',
                data: {
                    teamCode,
                    teamName,
                    registrationTime: new Date().toISOString()
                }
            })
        };

    } catch (error) {
        console.error('Registration error:', error);
        
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                success: false,
                message: 'Internal server error. Please try again.'
            })
        };
    }
};

// Helper function to initialize leaderboard entry
async function initializeLeaderboard(doc, teamCode, teamName) {
    try {
        // Get or create Leaderboard sheet
        let leaderboard = doc.sheetsByTitle['Leaderboard'];
        if (!leaderboard) {
            leaderboard = await doc.addSheet({
                title: 'Leaderboard',
                headerValues: [
                    'Team Code',
                    'Team Name',
                    'Total Score',
                    'Kindness Score',
                    'Scavenger Score', 
                    'Limerick Score',
                    'Quiz Score',
                    'Clue Hunt Score',
                    'Last Updated',
                    'Status'
                ]
            });
        }

        // Add team to leaderboard with zero scores
        await leaderboard.addRow({
            'Team Code': teamCode,
            'Team Name': teamName,
            'Total Score': 0,
            'Kindness Score': 0,
            'Scavenger Score': 0,
            'Limerick Score': 0,
            'Quiz Score': 0,
            'Clue Hunt Score': 0,
            'Last Updated': new Date().toISOString(),
            'Status': 'Active'
        });

        console.log(`Leaderboard initialized for team: ${teamCode}`);
    } catch (error) {
        console.error('Error initializing leaderboard:', error);
        // Don't throw error - team registration should still succeed
    }
}