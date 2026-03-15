require("dotenv").config();
const { runCourtAnalysis } = require('./court-analysis/pipeline');
const { synthesizeReport, createEvidenceFromProcessedCases } = require('./court-analysis/reasoning/synthesizer');
const fs = require('fs');

async function testWithRealData() {
    const oib = '66124057408'; // OIB provided by user
    console.log(`Starting real test with OIB: ${oib}`);

    try {
        console.log("Running pipeline (this may take a while)...");
        // We'll limit to 3 cases so it finishes in a reasonable time but has sufficient data
        const analysisResult = await runCourtAnalysis(
            oib, 
            { caseLimit: 3, enableVisualizer: false }, 
            (progress) => {
                console.log(`[Pipeline] ${progress.step}: ${progress.message}`);
            }
        );

        console.log("Pipeline finished. Creating evidence package...");
        const evidencePackage = createEvidenceFromProcessedCases(analysisResult.processedCases);
        
        console.log("Synthesizing report...");
        const report = await synthesizeReport(evidencePackage);

        console.log("================ SYNTHESIS REPORT ================");
        console.log(JSON.stringify(report, null, 2));
        console.log("==================================================");
        
        fs.writeFileSync('test-synthesizer-output.json', JSON.stringify(report, null, 2));
        console.log("Saved report to test-synthesizer-output.json");
        
        process.exit(0);
    } catch (err) {
        console.error("Error during test:", err);
        process.exit(1);
    }
}

testWithRealData();
