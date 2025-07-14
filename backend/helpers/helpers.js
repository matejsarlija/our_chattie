// Get most recent case per case number (since already sorted newest→oldest)
function getLatestCases(results) {
    const seenCases = new Set();
    return results.filter(result => {
        const caseId = result.caseNumber || result.title;
        if (!caseId || seenCases.has(caseId)) {
            return false;
        }
        seenCases.add(caseId);
        return true;
    });
}

// Chain of functions for analysis
async function analyzeCourtCases(cases) {
    const analyzed = [];
    
    for (const courtCase of cases) {
        if (courtCase.hasDocuments) {
            try {
                const analysis = await analyzeDocuments(courtCase.documentLinks);
                analyzed.push({
                    ...courtCase,
                    analysis,
                    status: 'analyzed'
                });
            } catch (error) {
                analyzed.push({
                    ...courtCase,
                    analysis: null,
                    status: 'analysis_failed',
                    error: error.message
                });
            }
        } else {
            analyzed.push({
                ...courtCase,
                analysis: null,
                status: 'no_documents'
            });
        }
    }
    
    return analyzed;
}

// Reuse your existing Google AI logic
async function analyzeDocuments(documentLinks) {
    // This is where you'd download files and use your existing 
    // Google AI analysis logic from your chat service
    // For now, return a placeholder
    return {
        summary: "Document analysis would go here",
        documentCount: documentLinks.length,
        documents: documentLinks.map(doc => ({
            name: doc.text,
            url: doc.url,
            // analysis: ... (your Google AI results)
        }))
    };
}