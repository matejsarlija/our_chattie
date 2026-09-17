// backend/court-analysis/reasoning/eval/fixtureLoader.js
//
// Purpose: Load and assemble eval fixtures through REAL production functions.
//          A fixture file stores { basePackage, analyses, gold } where
//          `analyses` uses the exact production individualAnalyses item shape
//          ({filePath, text, aiResult}). The loader runs everything through
//          attachAnalysesToEvidencePackage — the same code path the pipeline
//          uses — so metrics measure production behavior, not a hand-assembled
//          approximation of it.

const fs = require('fs');
const { attachAnalysesToEvidencePackage, validateClusterEvidencePackage } = require('../evidencePackage');
const { buildRetrievalChunks } = require('../chunker');
const { validateGoldLabels } = require('./goldSchema');

/**
 * Loads one fixture file and validates both halves.
 * @param {string} filePath - Path to a fixture JSON ({basePackage, analyses, rawDocuments?, gold}).
 * @returns {{pkg: object, gold: object, sourcePath: string}}
 */
function loadFixture(filePath) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    if (!raw?.basePackage || !Array.isArray(raw.analyses) || !raw.gold) {
        throw new Error(`${filePath}: fixture must contain basePackage, analyses and gold.`);
    }

    const pkg = attachAnalysesToEvidencePackage(
        raw.basePackage,
        [{ analysis: { individualAnalyses: raw.analyses } }],
        null
    );

    // rawDocuments simulate OCR-cache full texts. They ride the SAME
    // production chunker the pipeline uses, then land in pkg.chunks with
    // metadata shaped like the attach path produces — so grounding-gap spans
    // become retrievable exactly the way Phase 0.1 makes them reachable live.
    const rawDocChunks = (Array.isArray(raw.rawDocuments) ? raw.rawDocuments : []).flatMap((doc) => (
        buildRetrievalChunks(doc.text, { docId: doc.fileName }).map((chunk) => ({
            id: `${doc.fileName}::${chunk.id}`,
            text: chunk.text,
            metadata: {
                fileName: doc.fileName,
                caseNumber: raw.basePackage.clusterId || null,
                startIndex: chunk.metadata?.startIndex ?? null,
                endIndex: chunk.metadata?.endIndex ?? null
            }
        }))
    ));
    if (rawDocChunks.length > 0) {
        pkg.chunks = [...(pkg.chunks || []), ...rawDocChunks];
    }

    const packageValidation = validateClusterEvidencePackage(pkg);
    if (!packageValidation.valid) {
        throw new Error(`${filePath}: invalid assembled evidence package — ${packageValidation.error}`);
    }

    // Grounding-gap probes need a span that lives ONLY in raw full text.
    // Sample the first substantial sentence per rawDocument — same weak-gold
    // approach as realCorpusLane — and expose it on the loaded fixture so the
    // baseline suite can assert chunk-level retrievability without hardcoding
    // cluster-specific phrases.
    const rawDocumentSpans = (Array.isArray(raw.rawDocuments) ? raw.rawDocuments : [])
        .map((doc) => {
            const sentence = doc.text.split(/(?<=[.!?])\s+/).find((s) => s.length >= 140);
            return (sentence || doc.text.slice(0, 160)).slice(0, 160);
        })
        .filter((span) => span.trim().length >= 80);

    const goldValidation = validateGoldLabels(raw.gold);
    if (!goldValidation.valid) {
        throw new Error(`${filePath}: invalid gold labels — ${goldValidation.errors.join(' ')}`);
    }

    return { pkg, gold: raw.gold, rawDocumentSpans, floors: raw.thresholdFloors || null, sourcePath: filePath };
}

/**
 * Loads every *.fixture.json in a directory (or a single file).
 * @param {string} target - Directory or file path.
 * @returns {Array<{pkg: object, gold: object, sourcePath: string}>}
 */
function loadFixtures(target) {
    const stat = fs.statSync(target);
    if (stat.isFile()) return [loadFixture(target)];

    return fs.readdirSync(target)
        .filter((name) => name.endsWith('.fixture.json'))
        .sort()
        .map((name) => loadFixture(`${target}/${name}`));
}

module.exports = { loadFixture, loadFixtures };
