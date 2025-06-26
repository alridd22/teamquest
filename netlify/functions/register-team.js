const { GoogleSpreadsheet } = require('google-spreadsheet');

exports.handler = async (event, context) => {
  console.log('Function started');
  
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
    const { teamCode, teamName, teamPin } = JSON.parse(event.body);
    
    console.log('Team data received:', { teamCode, teamName, teamPin: teamPin ? '****' : undefined });

    if (!teamCode || !teamName || !teamPin) {
      throw new Error('Missing required fields');
    }

    if (!/^\d{4}$/.test(teamPin)) {
      throw new Error('PIN must be exactly 4 digits');
    }

    const sheetId = process.env.GOOGLE_SHEET_ID;
    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

    if (!sheetId || !serviceAccountEmail) {
      throw new Error('Missing environment variables');
    }

    console.log('Using compact service account authentication');
    
    // Reconstruct the private key from the original JSON
    const privateKey = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCGw+YMg87AxUpz
smaLvaq2ojIWpp0RRo1mTmk/grfaa4Mb4FOvAQdQy/4dWwat8lWe/HIG8kOLJzUD
tfgIWi5MpQbTjDgq/T+tTyk4b1LA8jyQme3r5RHz4Yoj4ILmq3bC0EmifkIvs+iD
Y1FhsmcMUFu7A+6ppCmD2vzGCvQA5nLNxlvgjTHtpWEME4h45kXEynM6+tc4PdEv
6ko7FSbcjwaKj7yygT8hSFFZjhxuPobcZP7ld1GxmaGIwSvAOiDbXTR388tqZHLW
MnvYE6AQ1tEbPBZh0EOZ0E9pTDYYjsryYZkQbTSR/L78aTA31ubgI4RkCZ1tRW4V
Qe8OZm+fAgMBAAECggEAPrTfkdow9Yy3kG8l/QbTbOi6ssRzGEtCVyTMH0O1Rbo6
BtoSRj+NxmAtDT7CNGUqxvADJM1MdW7YYbIlx8kiewJc00mPBx3Qp9VKQlq2YFY2
rTgat2VevaKn8vqwHiIRgCOH58alCGpHmf84KmPnRBkOHc5+GkxrDtHyRTpqgBIN
25yNXmseD0SmpktJyHojY3tjJvXQQIaWzj8OmuImKxDwLCFSp7FmHqcjj5avBGxb
ax6FHlDBxPToCaSq+QvU0aYH6PrnoCItw61EsJBt8+ZcAv9BOeEk4QTIZDYERfCp
QhfuSab6yNXqVFY9xikC2t2mIJAcLDbigwzjRJlyNQKBgQC9uBMokCp70pCzpSxB
8D6oBZMoupleDShXYNctTjBiB6jWBWl4URlf9wNs8xPy1vq8kjN88chYrx7GdJ9U
u/UTHmAssD7xuu6f85AX8VlTE/ehLBd1zlFh/WiJBa5RdANtbAJsStawjnUqBt+o
z0SVJrH16FDVRGxszklz4qzY5QKBgQC12OmyS96FNdeVcGPm9qEceeenxDu4K2q0
/7hrWOwHsynEVW/RL0zMsQs0VuCXtwuDARYgH2Wmgrpp/nRmLaM1W8A5qJzy8gvm
uUn1ebW3ibpp8/FYQ9ujokJuRYJPx5CDk7wmaGKI3hyS/Qd04KAcrX03nEm9Y+sV
+KnPMAiyMwKBgBcFDs4NMBp2IjiqAgS+MdwRURnQCmvvDMYNag6FPjmm1EWjwnhm
3r1WK4Q8ul7s1t+qnbS7YaPhG8rYu7x8UfBP7zt85yZNmEawNvuwvTXnZlSYFQCm
WBmbteNqXQxlF0VfpaueKQ6jOnQvAVRqUdgHKfC8j5JRCxbosODu0CpBAoGAY9fQ
IDv11jAEySEnSPWa6fao0X01yN3VvcE18YKmPWgKg6jhNvqAcVa3ryoQMFypLmmX
S1XRywW18mJqaHugQ7i3pzDD08Q/8pNDX0tPEZHGT0xH8812N7bsQH1bmhAZcZTY
1kGz8C/7glz5DhwS7Qv4V2MxPZIxziN0oLRf4e8CgYBu1VOlFl7uXaxMixPUZghU
KBWnf3uAzsOnnYBflkMy6XzjOf4hs7a4hN3zLQaQf1wl3HJoCcbmWi9epQTTnZPb
3d+UrOGXWrMK0SYM4eYywRTK7xwOY6/1Hqk4/p1SiISnMomjJx5vbPu3idnvJ9Dt
xGMKYlytcRo0Hb0f9UTUmg==
-----END PRIVATE KEY-----`;

    console.log('Authenticating with Google Sheets');
    
    // Use the simpler GoogleSpreadsheet authentication
    const doc = new GoogleSpreadsheet(sheetId);
    
    try {
      await doc.useServiceAccountAuth({
        client_email: serviceAccountEmail,
        private_key: privateKey,
      });
      console.log('Authentication successful');
    } catch (authError) {
      console.error('Auth failed:', authError.message);
      throw new Error(`Authentication failed: ${authError.message}`);
    }

    try {
      await doc.loadInfo();
      console.log('Sheet loaded:', doc.title);
    } catch (loadError) {
      console.error('Sheet load failed:', loadError.message);
      throw new Error(`Sheet access failed: ${loadError.message}`);
    }

    const sheet = doc.sheetsByIndex[0];
    await sheet.loadHeaderRow();
    
    // Set headers if needed
    if (!sheet.headerValues || sheet.headerValues.length === 0) {
      console.log('Setting up headers');
      await sheet.setHeaderRow(['Team Code', 'Team Name', 'Team PIN', 'Registration Time']);
    }

    // Check for duplicate PINs
    console.log('Checking for duplicate PIN');
    const rows = await sheet.getRows();
    const existingPin = rows.find(row => row.get('Team PIN') === teamPin);
    
    if (existingPin) {
      throw new Error(`PIN ${teamPin} is already in use. Please choose a different PIN.`);
    }

    // Add new team
    console.log('Adding team data');
    await sheet.addRow({
      'Team Code': teamCode,
      'Team Name': teamName,
      'Team PIN': teamPin,
      'Registration Time': new Date().toISOString(),
    });

    console.log('Team registered successfully');

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        message: 'Team registered successfully',
        teamCode,
        teamName,
      }),
    };

  } catch (error) {
    console.error('Registration error:', error);
    
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
    );
  }
};
