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

        // Initialize Google Sheets
        const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);

        // Authenticate using service account
        const serviceAccountAuth = {
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: Buffer.from(process.env.GOOGLE_PRIVATE_KEY_B64, 'base64').toString('utf8')
        };

        await doc.useServiceAccountAuth(serviceAccountAuth);
        await doc.loadInfo();

        console.log('Google Sheets connected successfully');

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
        const existingRow = rows.find(row => row['Team Code'] === teamCode);

        if (existingRow) {
            // Update existing row with completion data
            existingRow['Team Name'] = teamName;
            existingRow['Total Score'] = totalScore.toString();
            existingRow['Questions Correct'] = questionsCorrect ? questionsCorrect.toString() : '';
            existingRow['Total Questions'] = totalQuestions ? totalQuestions.toString() : '';
            existingRow['Completion Time'] = completionTime;
            existingRow['Duration (mins)'] = durationMinutes.toString();
            existingRow['Percentage'] = percentage.toString();
            existingRow['Submission Time'] = new Date().toISOString();
            
            // Preserve Quiz Start Time if it exists
            if (quizStartTime && !existingRow['Quiz Start Time']) {
                existingRow['Quiz Start Time'] = quizStartTime;
            }

            await existingRow.save();
            console.log('Updated existing quiz row for team:', teamCode);
        } else {
            // Create new row with all data
            const newRow = {
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
            };

            await quizSheet.addRow(newRow);
            console.log('Created new quiz row for team:', teamCode);
        }

        // Update leaderboard with quiz score
        try {
            const leaderboardSheet = doc.sheetsByTitle['Leaderboard'];
            if (leaderboardSheet) {
                await leaderboardSheet.loadHeaderRow();
                const leaderboardRows = await leaderboardSheet.getRows();
                
                const leaderboardRow = leaderboardRows.find(row => row['Team Code'] === teamCode);
                if (leaderboardRow) {
                    leaderboardRow['Quiz'] = totalScore.toString();
                    
                    // Recalculate total score
                    const registration = parseInt(leaderboardRow['Registration'] || '0', 10);
                    const clueHunt = parseInt(leaderboardRow['Clue Hunt'] || '0', 10);
                    const quiz = parseInt(leaderboardRow['Quiz'] || '0', 10);
                    const kindness = parseInt(leaderboardRow['Kindness'] || '0', 10);
                    const scavenger = parseInt(leaderboardRow['Scavenger'] || '0', 10);
                    const limerick = parseInt(leaderboardRow['Limerick'] || '0', 10);
                    
                    const newTotal = registration + clueHunt + quiz + kindness + scavenger + limerick;
                    leaderboardRow['Total'] = newTotal.toString();
                    
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
                    const answerRow = {
                        'Team Code': teamCode,
                        'Team Name': teamName,
                        'Question ID': answer.questionId ? answer.questionId.toString() : '',
                        'User Answer': answer.userAnswer || '',
                        'Correct Answer': answer.correctAnswer || '',
                        'Is Correct': answer.isCorrect ? 'TRUE' : 'FALSE',
                        'Doubloons Earned': answer.doubloons ? answer.doubloons.toString() : '0',
                        'Time Left': answer.timeLeft ? answer.timeLeft.toString() : '',
                        'Submission Time': new Date().toISOString()
                    };
                    
                    await answersSheet.addRow(answerRow);
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