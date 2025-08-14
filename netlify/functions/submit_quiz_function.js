const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

exports.handler = async (event, context) => {
    console.log('Submit Quiz request started at:', new Date().toISOString());

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
        console.log('Submit Quiz Request:', requestBody);

        const { 
            teamCode, 
            teamName, 
            totalScore, 
            questionsCorrect, 
            totalQuestions, 
            completionTime, 
            quizStartTime, 
            answers 
        } = requestBody;

        if (!teamCode || !teamName || totalScore === undefined) {
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    success: false, 
                    error: 'Missing required fields' 
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

        // Calculate duration if we have both start and completion times
        let durationMinutes = '';
        if (quizStartTime && completionTime) {
            const startTime = new Date(quizStartTime);
            const endTime = new Date(completionTime);
            const durationMs = endTime - startTime;
            durationMinutes = Math.round(durationMs / (1000 * 60) * 10) / 10; // Round to 1 decimal place
        }

        // Calculate percentage
        const percentage = totalQuestions > 0 ? Math.round((questionsCorrect / totalQuestions) * 100) : 0;

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

        // Load existing rows
        await quizSheet.loadHeaderRow();
        const rows = await quizSheet.getRows();

        // Find existing row for this team
        const existingRow = rows.find(row => row.get('Team Code') === teamCode);

        if (existingRow) {
            // Update existing row with completion data
            existingRow.set('Team Name', teamName);
            existingRow.set('Total Score', totalScore.toString());
            existingRow.set('Questions Correct', questionsCorrect ? questionsCorrect.toString() : '');
            existingRow.set('Total Questions', totalQuestions ? totalQuestions.toString() : '');
            existingRow.set('Completion Time', completionTime);
            existingRow.set('Duration (mins)', durationMinutes.toString());
            existingRow.set('Percentage', percentage.toString());
            existingRow.set('Submission Time', new Date().toISOString());
            
            // Preserve Quiz Start Time if it exists
            if (quizStartTime && !existingRow.get('Quiz Start Time')) {
                existingRow.set('Quiz Start Time', quizStartTime);
            }

            await existingRow.save();
            console.log('Updated existing quiz row for team:', teamCode);
        } else {
            // Create new row with all data
            const newRow = await quizSheet.addRow({
                'Team Code': teamCode,
                'Team Name': teamName,
                'Total Score': totalScore.toString(),
                'Questions Correct': questionsCorrect ? questionsCorrect.toString() : '',
                'Total Questions': totalQuestions ? totalQuestions.toString() : '',
                'Completion Time': completionTime,
                'Quiz Start Time': quizStartTime || '',
                'Duration (mins)': durationMinutes.toString(),
                'Percentage': percentage.toString(),
                'Submission Time': new Date().toISOString()
            });
            console.log('Created new quiz row for team:', teamCode);
        }

        // Update leaderboard with quiz score
        try {
            const leaderboardSheet = doc.sheetsByTitle['Leaderboard'];
            if (leaderboardSheet) {
                await leaderboardSheet.loadHeaderRow();
                const leaderboardRows = await leaderboardSheet.getRows();
                
                const leaderboardRow = leaderboardRows.find(row => row.get('Team Code') === teamCode);
                if (leaderboardRow) {
                    leaderboardRow.set('Quiz', totalScore.toString());
                    
                    // Recalculate total score
                    const registration = parseInt(leaderboardRow.get('Registration') || '0', 10);
                    const clueHunt = parseInt(leaderboardRow.get('Clue Hunt') || '0', 10);
                    const quiz = parseInt(leaderboardRow.get('Quiz') || '0', 10);
                    const kindness = parseInt(leaderboardRow.get('Kindness') || '0', 10);
                    const scavenger = parseInt(leaderboardRow.get('Scavenger') || '0', 10);
                    const limerick = parseInt(leaderboardRow.get('Limerick') || '0', 10);
                    
                    const newTotal = registration + clueHunt + quiz + kindness + scavenger + limerick;
                    leaderboardRow.set('Total', newTotal.toString());
                    
                    await leaderboardRow.save();
                    console.log('Updated leaderboard for team:', teamCode, 'with quiz score:', totalScore);
                } else {
                    console.log('Team not found in leaderboard:', teamCode);
                }
            }
        } catch (error) {
            console.error('Error updating leaderboard:', error);
            // Don't fail the entire operation if leaderboard update fails
        }

        // Store individual answers in Quiz Answers sheet (if needed for detailed analysis)
        try {
            let answersSheet = doc.sheetsByTitle['Quiz Answers'];
            if (answersSheet && answers && Array.isArray(answers)) {
                await answersSheet.loadHeaderRow();
                
                // Add each answer as a separate row
                for (const answer of answers) {
                    await answersSheet.addRow({
                        'Team Code': teamCode,
                        'Team Name': teamName,
                        'Question ID': answer.questionId ? answer.questionId.toString() : '',
                        'User Answer': answer.userAnswer || '',
                        'Correct Answer': answer.correctAnswer || '',
                        'Is Correct': answer.isCorrect ? 'TRUE' : 'FALSE',
                        'Doubloons Earned': answer.doubloons ? answer.doubloons.toString() : '0',
                        'Time Left': answer.timeLeft ? answer.timeLeft.toString() : '',
                        'Submission Time': new Date().toISOString()
                    });
                }
                console.log('Stored', answers.length, 'quiz answers for team:', teamCode);
            }
        } catch (error) {
            console.error('Error storing quiz answers:', error);
            // Don't fail the entire operation if answer storage fails
        }

        console.log('Quiz submission completed successfully for team:', teamCode);

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                success: true,
                message: 'Quiz results submitted successfully',
                teamCode: teamCode,
                totalScore: totalScore,
                questionsCorrect: questionsCorrect,
                percentage: percentage
            })
        };

    } catch (error) {
        console.error('Submit Quiz Function Error:', error);
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
