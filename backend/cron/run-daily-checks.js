// cron/run-daily-checks.js
require('dotenv').config(); // Load environment variables
const db = require('../db'); // Reuse your DB connection logic
const CourtSearchPuppeteer = require('../scraper/courtSearchPuppeteer');
const { runCourtAnalysis } = require('../court-analysis/pipeline');
// You'll need an email service. Let's create a placeholder for it.
const { sendUpdateEmail } = require('../services/email-service');

async function main() {
    console.log('Cron job started: Checking for court case updates...');

    try {
        // 1. Get all active subscriptions from the database
        const { rows: subscriptions } = await db.query(
            'SELECT * FROM subscriptions WHERE is_active = TRUE'
        );

        if (subscriptions.length === 0) {
            console.log('No active subscriptions. Exiting.');
            return;
        }

        console.log(`Found ${subscriptions.length} active subscriptions to check.`);

        // 2. Loop through each subscription and check for updates
        for (const sub of subscriptions) {
            console.log(`\n--- Checking for: "${sub.search_term}" for user ${sub.email} ---`);
            const automator = new CourtSearchPuppeteer();
            try {
                await automator.init();
                // We only care about the single MOST RECENT case
                const latestCases = await automator.searchAndGetLatestCasesWithDocuments(sub.search_term, 1);

                if (!latestCases || latestCases.length === 0) {
                    console.log('No cases found for this term. Skipping.');
                    continue;
                }

                const latestCase = latestCases[0].caseResult;
                // Create a unique identifier for the found case
                const currentCaseIdentifier = `${latestCase.caseNumber} - ${latestCase.date}`;

                // 3. THE CRITICAL CHECK: Is this a new case?
                if (currentCaseIdentifier === sub.last_seen_case_identifier) {
                    console.log(`No new updates. Last seen case "${currentCaseIdentifier}" matches current.`);
                    continue;
                }

                console.log(`NEW UPDATE FOUND! Old: "${sub.last_seen_case_identifier}", New: "${currentCaseIdentifier}"`);

                // 4. We found a new case! Analyze it.
                // Note: runCourtAnalysis is designed for multiple cases, but works fine for one.
                const analysisResult = await runCourtAnalysis(sub.search_term, 1, (progress) => {
                    // The cron job can log progress, but there's no user to send it to.
                    console.log(`[Analysis Progress for ${sub.search_term}]: ${progress.message}`);
                });

                // 5. Send the notification email
                await sendUpdateEmail({
                    to: sub.email,
                    searchTerm: sub.search_term,
                    caseInfo: analysisResult.processedCases[0].caseResult,
                    analysis: analysisResult.comparativeAnalysis, // This will be the detailed summary for the single case
                    unsubscribeToken: sub.unsubscribe_token
                });
                
                console.log(`Email sent successfully to ${sub.email}.`);

                // 6. IMPORTANT: Update the database with the new identifier
                await db.query(
                    'UPDATE subscriptions SET last_seen_case_identifier = $1 WHERE id = $2',
                    [currentCaseIdentifier, sub.id]
                );
                console.log('Database updated with new last_seen_case_identifier.');

            } catch (error) {
                console.error(`Error processing subscription ID ${sub.id} for term "${sub.search_term}":`, error.message);
                // Continue to the next subscription even if one fails
            } finally {
                await automator.close();
            }
        }
    } catch (err) {
        console.error('FATAL CRON JOB ERROR:', err);
    } finally {
        // Ensure the script exits so the cron job container can shut down.
        process.exit();
    }
}

main();