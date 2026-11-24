'use strict';

const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { extractTextFromFile, buildAnalysisPrompt } = require('../court-analysis/agents/analysis-agent');
const { splitTextIntoChunks } = require('../court-analysis/reasoning/chunker');
const { requestChat } = require('./lib/openrouter-client');

const MODEL = 'z-ai/glm-5.3-flash';
const FIXTURE = path.resolve(__dirname, '../tests/fixtures/real-documents/66124057408/entries/19-ST-22013/Diobeni popis.pdf');
const ARTIFACT_ROOT = path.resolve(__dirname, '../data/pdf-engine-bench/phase1-artifacts');
const EUR_PER_USD_BUDGET_GUARD = 1;

function parseArgs(argv) {
    const options = { dryRun: false, approved: false, maxCostEur: null, resumeB4B5: false, resumeB5: false };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--dry-run') options.dryRun = true;
        else if (argv[i] === '--approved') options.approved = true;
        else if (argv[i] === '--resume-b4-b5') options.resumeB4B5 = true;
        else if (argv[i] === '--resume-b5') options.resumeB5 = true;
        else if (argv[i] === '--max-cost') {
            const value = Number(argv[++i]);
            if (!Number.isFinite(value) || value <= 0) throw new Error('--max-cost must be a positive EUR amount');
            options.maxCostEur = value;
        } else {
            throw new Error(`Unknown argument: ${argv[i]}`);
        }
    }
    return options;
}

function makePayload(prompt, condition) {
    const payload = {
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 16384,
        reasoning: { effort: 'low' },
    };
    if (condition === 'condition-a') payload.provider = { order: ['Z.AI'] };
    else {
        payload.response_format = { type: 'json_object' };
        payload.provider = { order: ['Z.AI'], require_parameters: true };
    }
    return payload;
}

function parseErrorDetails(error, text) {
    const message = String(error.message);
    const positionMatch = message.match(/position\s+(\d+)/i);
    const unexpectedToken = message.match(/Unexpected token '([^']+)'/);
    const characterOffset = positionMatch
        ? Number(positionMatch[1])
        : unexpectedToken && unexpectedToken[1] === text[0] ? 0 : null;
    let line = null;
    let column = null;
    let context = null;
    if (characterOffset !== null) {
        const before = text.slice(0, characterOffset);
        line = (before.match(/\n/g) || []).length + 1;
        column = characterOffset - before.lastIndexOf('\n');
        const start = Math.max(0, characterOffset - 100);
        const end = Math.min(text.length, characterOffset + 100);
        context = text.slice(start, end);
    }
    return {
        message: error.message,
        stack: error.stack,
        characterOffset,
        line,
        column,
        contextSnippet: context,
    };
}

function outputText(response) {
    const choice = response?.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((part) => typeof part?.text === 'string' ? part.text : '').join('');
    return '';
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.resumeB4B5 && options.resumeB5) throw new Error('Choose only one resume mode');
    if (!options.dryRun && (!options.approved || options.maxCostEur === null)) {
        throw new Error('Live execution requires both --approved and --max-cost <EUR>');
    }
    if (options.maxCostEur !== null && options.maxCostEur > 0.5) {
        throw new Error('Phase 1 spend is capped at €0.50');
    }

    const extraction = await extractTextFromFile(FIXTURE);
    if (extraction.error || typeof extraction.text !== 'string' || !extraction.text) {
        throw new Error(`Fixture text extraction failed: ${extraction.error || 'empty text'}`);
    }
    const chunks = splitTextIntoChunks(extraction.text, {
        chunkSize: 3500,
        chunkOverlap: 350,
        docId: 'diobeni',
    });
    const segment = chunks[5];
    if (!segment) throw new Error(`Segment 6 missing; extracted ${chunks.length} chunks`);
    const prompt = buildAnalysisPrompt('Participant information was not available from the source page.', segment.text);
    const payloads = {
        'condition-a': makePayload(prompt, 'condition-a'),
        'condition-b': makePayload(prompt, 'condition-b'),
    };
    const segmentInfo = {
        extractionMethod: extraction.method,
        pages: extraction.pages,
        textCharacters: extraction.text.length,
        segment: 6,
        segmentCharacters: segment.text.length,
        startOffset: segment.metadata.startIndex,
        endOffset: segment.metadata.endIndex,
        expectedOffsets: [15710, 19191],
        offsetsMatchExpected: segment.metadata.startIndex === 15710 && segment.metadata.endIndex === 19191,
        chunkCount: chunks.length,
        promptCharacters: prompt.length,
        payloadShapes: Object.fromEntries(Object.entries(payloads).map(([name, payload]) => [name, {
            model: payload.model,
            provider: payload.provider,
            response_format: payload.response_format || null,
            max_tokens: payload.max_tokens,
            reasoning: payload.reasoning,
            messageCount: payload.messages.length,
            promptCharacters: payload.messages[0].content.length,
        }])),
    };

    if (options.dryRun) {
        console.log(JSON.stringify({ mode: 'dry-run', fixture: path.relative(process.cwd(), FIXTURE), ...segmentInfo }, null, 2));
        return;
    }
    if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required for live execution');

    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const runDirectory = path.join(ARTIFACT_ROOT, `run-${runId}`);
    fs.mkdirSync(runDirectory, { recursive: true });
    fs.writeFileSync(path.join(runDirectory, 'run-metadata.json'), `${JSON.stringify({
        startedAt: new Date().toISOString(),
        model: MODEL,
        fixture: path.relative(process.cwd(), FIXTURE),
        maxCostEur: options.maxCostEur,
        eurPerUsdBudgetGuard: EUR_PER_USD_BUDGET_GUARD,
        resumeB5: options.resumeB5,
    }, null, 2)}\n`);

    let spendUsd = 0;
    let unknownCost = false;
    const results = [];
    const plannedCalls = options.resumeB4B5
        ? [4, 5].map((repeat) => ({ condition: 'condition-b', repeat }))
        : options.resumeB5
            ? [{ condition: 'condition-b', repeat: 5 }]
            : ['condition-a', 'condition-b'].flatMap((condition) =>
                Array.from({ length: 5 }, (_, index) => ({ condition, repeat: index + 1 })));
    for (const { condition, repeat } of plannedCalls) {
        if (unknownCost) {
            console.error(`Budget guard stopped scheduling after an ambiguous-cost request before ${condition}-${repeat}`);
            break;
        }
        if (spendUsd * EUR_PER_USD_BUDGET_GUARD >= options.maxCostEur) {
            console.error(`Budget guard stopped run before ${condition}-${repeat}: accrued USD spend=${spendUsd.toFixed(6)}`);
            break;
        }
        const artifactDirectory = path.join(runDirectory, `${condition}-${repeat}`);
        fs.mkdirSync(artifactDirectory, { recursive: true });
        const startedAt = new Date().toISOString();
        const result = await requestChat(payloads[condition], {
            label: `${condition}-${repeat}`,
            timeoutMs: 120000,
            maxRetries: 0,
        });
        const rawText = outputText(result.response);
        // Persist exact assistant text before JSON parsing; no repair or normalization is performed.
        fs.writeFileSync(path.join(artifactDirectory, 'raw_assistant_text.txt'), rawText, 'utf8');

        const costUsd = result.cost == null ? null : Number.isFinite(Number(result.cost)) ? Number(result.cost) : null;
        if (costUsd !== null) spendUsd += costUsd;
        else unknownCost = true;
        const usage = result.usage || {};
        const metadata = {
            startedAt,
            completedAt: new Date().toISOString(),
            httpStatus: result.status,
            provider: result.provider,
            model: result.model,
            finishReason: result.finish_reason,
            promptTokens: usage.prompt_tokens ?? usage.input_tokens ?? null,
            completionTokens: usage.completion_tokens ?? usage.output_tokens ?? null,
            reasoningTokens: usage.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens ?? null,
            totalTokens: usage.total_tokens ?? null,
            latencyMs: result.latencyMs,
            costUsd,
            costEurBudgetEquivalent: costUsd === null ? null : costUsd * EUR_PER_USD_BUDGET_GUARD,
            requestError: result.error,
            diagnostics: result.diagnostics || null,
            retries: result.retries,
        };
        fs.writeFileSync(path.join(artifactDirectory, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);

        let parsePassed = false;
        let parseError = null;
        if (rawText) {
            try {
                JSON.parse(rawText);
                parsePassed = true;
            } catch (error) {
                parseError = parseErrorDetails(error, rawText);
                fs.writeFileSync(path.join(artifactDirectory, 'error.json'), `${JSON.stringify(parseError, null, 2)}\n`);
            }
        } else {
            parseError = { message: result.error || 'No assistant text returned', characterOffset: null, line: null, column: null, contextSnippet: null };
            fs.writeFileSync(path.join(artifactDirectory, 'error.json'), `${JSON.stringify(parseError, null, 2)}\n`);
        }
        results.push({ condition, repeat, parsePassed, finishReason: result.finish_reason, latencyMs: result.latencyMs, costUsd, costUnknown: costUsd === null, provider: result.provider, httpStatus: result.status });
        console.log(JSON.stringify({ ...results[results.length - 1], accruedSpendUsd: spendUsd, accruedEurBudgetEquivalent: spendUsd * EUR_PER_USD_BUDGET_GUARD }));
    }
    fs.writeFileSync(path.join(runDirectory, 'summary.json'), `${JSON.stringify({ completedAt: new Date().toISOString(), spendUsd, costUnknown: unknownCost, eurPerUsdBudgetGuard: EUR_PER_USD_BUDGET_GUARD, spendEurBudgetEquivalent: spendUsd * EUR_PER_USD_BUDGET_GUARD, results }, null, 2)}\n`);
    console.log(JSON.stringify({ runDirectory, spendUsd, costUnknown: unknownCost, spendEurBudgetEquivalent: spendUsd * EUR_PER_USD_BUDGET_GUARD, callsCompleted: results.length }, null, 2));
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
