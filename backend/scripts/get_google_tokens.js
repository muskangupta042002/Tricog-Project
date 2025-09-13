// Usage: node backend/scripts/get_google_tokens.js
//
// This script checks for GOOGLE_ACCESS_TOKEN and GOOGLE_REFRESH_TOKEN in environment,
// and if not present, runs the OAuth2 flow to get them using the credentials from
// GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI.
//
// Requirements: npm install googleapis dotenv readline

const { google } = require('googleapis');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Load .env if present
require('dotenv').config();

function checkTokens() {
    const access = process.env.GOOGLE_ACCESS_TOKEN || '';
    const refresh = process.env.GOOGLE_REFRESH_TOKEN || '';
    if (access && refresh) {
        console.log('✅ GOOGLE_ACCESS_TOKEN and GOOGLE_REFRESH_TOKEN exist in environment.');
        return true;
    } else {
        console.log('⚠️  Google OAuth tokens are missing or incomplete.');
        return false;
    }
}

async function getTokensInteractive() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
        console.error('ERROR: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI must be set in environment variables or .env');
        process.exit(1);
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    const scopes = [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events'
    ];

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent'
    });

    console.log('\nStep 1: Go to the following URL in your browser and authorize access:\n');
    console.log(authUrl);
    console.log('\nStep 2: After authorizing, Google will redirect to your redirect_uri with a code parameter.');
    console.log('Paste the code below:\n');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    rl.question('Enter the full code here: ', async (code) => {
        rl.close();
        try {
            const { tokens } = await oauth2Client.getToken(code.trim());
            console.log('\n✅ Successfully obtained tokens:');
            console.log(`GOOGLE_ACCESS_TOKEN=${tokens.access_token}`);
            console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);

            const dotenvPath = path.resolve(process.cwd(), '.env');
            let appendEnv = `
GOOGLE_ACCESS_TOKEN=${tokens.access_token}
GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}
`;
            // Optionally write to .env if present (with prompt)
            if (fs.existsSync(dotenvPath)) {
                const r2 = readline.createInterface({ input: process.stdin, output: process.stdout });
                r2.question(`Do you want to append these tokens to .env? (y/N): `, (ans) => {
                    if (ans.toLowerCase().startsWith('y')) {
                        fs.appendFileSync(dotenvPath, appendEnv);
                        console.log(`Tokens appended to ${dotenvPath}`);
                    } else {
                        console.log('Tokens NOT written to .env. Please add manually if required.');
                    }
                    r2.close();
                });
            }
        } catch (err) {
            console.error('❌ Error exchanging code for tokens:', err.message);
            process.exit(1);
        }
    });
}

(async () => {
    if (!checkTokens()) {
        await getTokensInteractive();
    }
})();
