#!/usr/bin/env node

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CourtSearchPuppeteer = require("../scraper/courtSearchPuppeteer");
const { processScrapedCases } = require("../court-analysis/pipeline");
const {
    DEFAULT_CASE_LIMIT,
    MIN_CASE_LIMIT,
    MAX_CASE_LIMIT,
} = require("../helpers/courtAnalysisRequest");

const RAW_SCRAPE_MULTIPLIER = 3;
const backendRoot = path.resolve(__dirname, "..");
const uploadsDir = path.join(backendRoot, "uploads");
const fixturesDir = path.join(backendRoot, "fixtures", "analysis-baselines");

function parseArgs(argv) {
    const parsed = {
        searchTerm: null,
        caseLimit: DEFAULT_CASE_LIMIT,
        scrapeLimit: null,
        output: null,
        label: null,
        noVisualizer: false,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const value = argv[i];

        if (value === "--search-term" || value === "-s") {
            parsed.searchTerm = argv[i + 1];
            i += 1;
            continue;
        }

        if (value === "--case-limit" || value === "-c") {
            parsed.caseLimit = Number.parseInt(argv[i + 1], 10);
            i += 1;
            continue;
        }

        if (value === "--scrape-limit") {
            parsed.scrapeLimit = Number.parseInt(argv[i + 1], 10);
            i += 1;
            continue;
        }

        if (value === "--output" || value === "-o") {
            parsed.output = argv[i + 1];
            i += 1;
            continue;
        }

        if (value === "--label" || value === "-l") {
            parsed.label = argv[i + 1];
            i += 1;
            continue;
        }

        if (value === "--no-visualizer") {
            parsed.noVisualizer = true;
            continue;
        }
    }

    if (!parsed.searchTerm) {
        throw new Error("Missing required --search-term argument.");
    }

    return parsed;
}

function clampCaseLimit(rawLimit) {
    const numeric = Number.parseInt(String(rawLimit), 10);
    if (Number.isNaN(numeric)) return DEFAULT_CASE_LIMIT;
    if (numeric < MIN_CASE_LIMIT) return MIN_CASE_LIMIT;
    if (numeric > MAX_CASE_LIMIT) return MAX_CASE_LIMIT;
    return numeric;
}

function computeRawScrapeLimit(caseLimit) {
    const normalizedLimit = clampCaseLimit(caseLimit);
    return Math.min(
        normalizedLimit * RAW_SCRAPE_MULTIPLIER,
        MAX_CASE_LIMIT * RAW_SCRAPE_MULTIPLIER,
    );
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function safeFileLabel(input) {
    return String(input)
        .trim()
        .replace(/[^\w.-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120);
}

function getGitCommit() {
    try {
        return execSync("git rev-parse HEAD", {
            cwd: path.resolve(backendRoot, ".."),
            stdio: ["ignore", "pipe", "ignore"],
            encoding: "utf8",
        }).trim();
    } catch (_err) {
        return null;
    }
}

function listUploadFiles() {
    if (!fs.existsSync(uploadsDir)) return [];
    return fs
        .readdirSync(uploadsDir)
        .filter((name) => fs.statSync(path.join(uploadsDir, name)).isFile())
        .sort();
}

function summarizeDiscoveredEntries(entries) {
    return (entries || []).map((entry, index) => ({
        index,
        caseNumber: entry?.caseInfo?.caseNumber || entry?.caseNumber || null,
        title: entry?.caseInfo?.title || entry?.title || null,
        court: entry?.caseInfo?.court || null,
        date: entry?.caseInfo?.date || entry?.caseInfo?.datePublished || null,
        detailLink: entry?.caseInfo?.detailLink || entry?.detailLink || null,
        documentCount: Array.isArray(entry?.documentLinks)
            ? entry.documentLinks.length
            : 0,
        documentLinks: Array.isArray(entry?.documentLinks)
            ? entry.documentLinks
            : [],
    }));
}

function summarizeProcessedCases(processedCases) {
    return (processedCases || []).map((item, index) => {
        const analyses = item?.analysis?.individualAnalyses || [];
        const entries = item?.entries || [];

        return {
            index,
            caseNumber: item?.caseResult?.caseNumber || null,
            title: item?.caseResult?.title || null,
            court: item?.caseResult?.court || null,
            date: item?.caseResult?.date || null,
            entryCount: entries.length,
            entryDates: entries
                .map(
                    (entry) =>
                        entry?.caseInfo?.date ||
                        entry?.caseInfo?.datePublished ||
                        null,
                )
                .filter(Boolean),
            participants: Array.isArray(item?.caseResult?.participants)
                ? item.caseResult.participants.map((participant) => ({
                      name: participant?.name || null,
                      role: participant?.role || null,
                  }))
                : [],
            files: Array.isArray(item?.files)
                ? item.files.map((file) => ({
                      name: file?.name || null,
                      path: file?.path || null,
                      url: file?.url || null,
                  }))
                : [],
            analyses: analyses.map((analysis, analysisIndex) => ({
                index: analysisIndex,
                fileName: analysis?.fileName || null,
                filePath: analysis?.filePath || null,
                error: analysis?.error || null,
                summary: analysis?.aiResult?.summary || null,
                decisionDate: analysis?.aiResult?.decisionDate || null,
                parties: analysis?.aiResult?.parties || [],
            })),
        };
    });
}

function collectUploadReferences(value, acc = new Set()) {
    if (Array.isArray(value)) {
        value.forEach((item) => collectUploadReferences(item, acc));
        return acc;
    }

    if (value && typeof value === "object") {
        Object.values(value).forEach((item) =>
            collectUploadReferences(item, acc),
        );
        return acc;
    }

    if (typeof value === "string") {
        if (value.includes("/uploads/") || value.includes("backend/uploads/")) {
            acc.add(value);
        }
    }

    return acc;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const caseLimit = clampCaseLimit(args.caseLimit);
    const scrapeLimit = Number.isInteger(args.scrapeLimit)
        ? args.scrapeLimit
        : computeRawScrapeLimit(caseLimit);

    const label = safeFileLabel(args.label || args.searchTerm);
    const outputPath =
        args.output ||
        path.join(
            fixturesDir,
            `${new Date().toISOString().slice(0, 10)}-${label}.json`,
        );

    ensureDir(path.dirname(outputPath));

    const progressEvents = [];
    const uploadsBefore = listUploadFiles();
    const automator = new CourtSearchPuppeteer();

    let discoveredEntries = [];
    let result = null;

    try {
        console.log(`[capture] searchTerm=${args.searchTerm}`);
        console.log(
            `[capture] caseLimit=${caseLimit} scrapeLimit=${scrapeLimit}`,
        );
        console.log(`[capture] output=${outputPath}`);

        await automator.init();

        console.log("[capture] discovering entries...");
        discoveredEntries =
            await automator.searchAndGetLatestCasesWithDocuments(
                args.searchTerm,
                scrapeLimit,
            );

        console.log(`[capture] discovered ${discoveredEntries.length} entries`);
        console.log(
            "[capture] processing discovered entries through existing analysis pipeline...",
        );

        result = await processScrapedCases(
            discoveredEntries,
            (event) => {
                progressEvents.push(event);
                const step = event?.step || "progress";
                const progress = event?.progress ?? "?";
                const message = event?.message || "";
                console.log(`[progress] ${step} ${progress}: ${message}`);
            },
            {
                caseLimit,
                enableVisualizer: !args.noVisualizer,
            },
        );
    } finally {
        await automator.close();
    }

    const uploadsAfter = listUploadFiles();
    const uploadReferences = Array.from(collectUploadReferences(result)).sort();

    const payload = {
        meta: {
            capturedAt: new Date().toISOString(),
            gitCommit: getGitCommit(),
            searchTerm: args.searchTerm,
            caseLimit,
            scrapeLimit,
            visualizerEnabled: !args.noVisualizer,
            note: "Captured from existing analysis pipeline only. No reasoning synthesizer/verifier modules are invoked here.",
        },
        progressEvents,
        discovery: {
            count: discoveredEntries.length,
            caseNumbers: Array.from(
                new Set(
                    discoveredEntries
                        .map(
                            (entry) =>
                                entry?.caseInfo?.caseNumber ||
                                entry?.caseNumber ||
                                null,
                        )
                        .filter(Boolean),
                ),
            ).sort(),
            entries: summarizeDiscoveredEntries(discoveredEntries),
        },
        pipeline: {
            processedCaseCount: Array.isArray(result?.processedCases)
                ? result.processedCases.length
                : 0,
            processedCases: summarizeProcessedCases(
                result?.processedCases || [],
            ),
            comparativeAnalysis: result?.comparativeAnalysis || null,
            visualization: result?.visualization || null,
            rawResult: result,
        },
        uploads: {
            before: uploadsBefore,
            after: uploadsAfter,
            newFilesStillPresent: uploadsAfter.filter(
                (name) => !uploadsBefore.includes(name),
            ),
            referencedPaths: uploadReferences,
        },
    };

    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
    console.log(`[capture] wrote fixture to ${outputPath}`);
}

main().catch((error) => {
    console.error("[capture] failed:", error);
    process.exitCode = 1;
});
