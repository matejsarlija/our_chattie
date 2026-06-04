const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { withGeminiRetry } = require("../../helpers/geminiRetry");
require("dotenv").config();

const gemini = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    apiKey: process.env.GOOGLE_API_KEY,
    temperature: 0.1
});

function normalizeFindingsForVerification(report) {
    if (Array.isArray(report?.findings) && report.findings.length > 0) {
        return report.findings;
    }

    if (!Array.isArray(report?.claims)) {
        return [];
    }

    return report.claims.map((claim, index) => ({
        id: claim.id || `finding-${index + 1}`,
        text: claim.text,
        confidence: claim.confidence || 'medium',
        citations: claim.evidence || []
    }));
}

async function verifyReport(report, evidencePackage) {
    const findingsToVerify = normalizeFindingsForVerification(report);

    if (!report || findingsToVerify.length === 0) {
        return report;
    }

    const verifiedFindings = [];
    const openQuestions = [...(report.openQuestions || [])];
    const conflicts = [...(report.conflicts || [])];

    const evidenceText = [
        ...(evidencePackage.timeline || []).map(event => `[Date: ${event.date}] ${event.description}`),
        ...(evidencePackage.claims || []).map(claim => `[Source Claim] ${claim.text}`),
        ...(evidencePackage.claims || []).flatMap(claim => (claim.evidence || []).map(ev => `[Citation ${ev.sourceId}] ${ev.text}`))
    ].join('\n');

    const claimsList = findingsToVerify.map((finding, index) => `${index + 1}. ${finding.text}`).join('\n');

    const prompt = `
    You are a strict legal verification engine.
    Your task is to verify the following FINDINGS against the provided EVIDENCE.

    EVIDENCE:
    ${evidenceText}

    FINDINGS TO VERIFY:
    ${claimsList}

    INSTRUCTIONS:
    For each finding:
    1. Determine if it is "supported" by the evidence, "contradicted" by the evidence, or "unsupported".
    2. If supported, cite the specific evidence snippet.
    3. If contradicted, explain the conflict.

    OUTPUT FORMAT:
    Return strictly JSON array:
    [
        {
            "index": 1,
            "status": "supported|contradicted|unsupported",
            "reason": "explanation",
            "confidence": "high|medium|low"
        }
    ]
    `;

    try {
        const response = await withGeminiRetry(() => gemini.invoke(prompt));
        const cleanJson = response.content.replace(/```json\n?|```/g, "").trim();
        const verificationResults = JSON.parse(cleanJson);

        findingsToVerify.forEach((finding, index) => {
            const result = verificationResults.find(item => item.index === index + 1);

            if (!result) {
                verifiedFindings.push(finding);
                return;
            }

            if (result.status === 'supported') {
                verifiedFindings.push({
                    ...finding,
                    confidence: result.confidence || 'high',
                    citations: [...(finding.citations || []), { sourceId: 'verification-pass', text: result.reason }]
                });
                return;
            }

            if (result.status === 'contradicted') {
                conflicts.push({
                    finding: finding.text,
                    reason: result.reason
                });
                verifiedFindings.push({
                    ...finding,
                    confidence: 'low',
                    citations: [...(finding.citations || []), { sourceId: 'verification-contradiction', text: result.reason }]
                });
                return;
            }

            openQuestions.push(`Unverified finding: ${finding.text}`);
        });

        return {
            ...report,
            findings: verifiedFindings,
            verifiedFindings,
            openQuestions,
            conflicts
        };
    } catch (error) {
        console.error("Verification failed:", error);
        return report;
    }
}

module.exports = { verifyReport };
