const STAGE_LABELS = {
    discovering: 'pronalaženja objava',
    grouping: 'grupiranja pronađenih predmeta',
    downloading: 'preuzimanja dokumenata',
    extracting: 'raspakiravanja dokumenata',
    reasoning: 'analize i sintetiziranja izvješća',
    verifying: 'provjere nalaza',
    complete: 'završetka obrade'
};

const DAILY_LIMIT_MESSAGE = 'Dnevni limit AI analize je iscrpljen. Pokušajte ponovno sutra ili s manjim brojem predmeta.';
const TRANSIENT_MESSAGE = 'AI servis je trenutno preopterećen (privremeno ograničenje učestalosti zahtjeva). Pokušajte ponovno za nekoliko minuta.';
const TIMEOUT_MESSAGE = 'Zahtjev AI servisu je premašio dopušteno vrijeme čekanja i automatski je prekinut. Pokušajte ponovno.';
const MALFORMED_JSON_MESSAGE = 'AI odgovor nije bio valjani JSON pa dokument čeka ponovnu obradu.';
const TRUNCATION_MESSAGE = 'AI odgovor je prekinut zbog ograničenja veličine pa dokument čeka ponovnu obradu.';
const SCHEMA_MISMATCH_MESSAGE = 'Struktura AI odgovora nije valjana pa dokument čeka ponovnu obradu.';

function describeStage(stage) {
    return STAGE_LABELS[stage] || 'obrade zahtjeva';
}

// Error taxonomy is programmatic, not textual: classification reads the
// provider's structured fields (status, quota metric, retry delay) first and
// treats message text as a fallback. A bare "resource exhausted" without a
// daily signal is a transient burst, never a daily limit — the daily verdict
// requires an explicit per-day marker.
function parseRetryDelayMs(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    const match = /^(\d+(?:\.\d+)?)\s*s$/i.exec(String(value || '').trim());
    if (match) return Number(match[1]) * 1000;
    return null;
}

function extractProviderError(error) {
    const err = (error && typeof error === 'object') ? error : {};
    const body = (err.response && typeof err.response.data?.error === 'object')
        ? err.response.data.error
        : {};
    const details = Array.isArray(body.details) ? body.details : [];
    let quotaMetric = null;
    let retryDelayMs = null;
    for (const detail of details) {
        const type = String(detail?.['@type'] || '');
        if (type.endsWith('google.rpc.QuotaFailure')) {
            const violation = Array.isArray(detail.violations) ? detail.violations[0] : null;
            quotaMetric = violation?.quotaMetric || violation?.quotaId || quotaMetric;
        }
        if (type.endsWith('google.rpc.RetryInfo')) {
            retryDelayMs = parseRetryDelayMs(detail.retryDelay) ?? retryDelayMs;
        }
    }
    const message = typeof err.message === 'string' && err.message
        ? err.message
        : (typeof body.message === 'string' ? body.message : String(error || ''));
    return {
        __extracted: true,
        status: err.status ?? err.response?.status ?? body.code ?? null,
        providerCode: body.code ?? err.code ?? null,
        quotaMetric,
        retryDelayMs,
        message,
    };
}

const isExtracted = (value) => Boolean(value && typeof value === 'object' && value.__extracted);

const DAILY_SIGNAL_RE =
    /per[_-]?day|requests_per_day|\bdaily\b|dnevni limit|daily limit|limit[^.]{0,60}per day|exceeded[^.]{0,60}daily/i;
const DAILY_METRIC_RE = /perday|per_day|daily/i;
const TRANSIENT_RATE_LIMIT_RE =
    /\b429\b|rate[ _-]?limit|too many requests|overloaded|temporarily (unavailable|overloaded)|resource[ -]?exhausted|exhausted|rpm|tpm|requests[_ -]?per[_-]?(second|minute|token|character)/i;

function hasDailySignal(extracted) {
    return DAILY_SIGNAL_RE.test(extracted.message || '') || DAILY_METRIC_RE.test(extracted.quotaMetric || '');
}

function isDailyQuotaExhaustion(reason) {
    if (isExtracted(reason)) return hasDailySignal(reason);
    if (reason && typeof reason === 'object') return hasDailySignal(extractProviderError(reason));
    return DAILY_SIGNAL_RE.test(String(reason || ''));
}

function isTransientRateLimit(reason) {
    const extracted = isExtracted(reason)
        ? reason
        : ((reason && typeof reason === 'object') ? extractProviderError(reason) : null);
    const message = extracted ? extracted.message : String(reason || '');
    if (hasDailySignal(extracted || { message })) return false;
    if (extracted && (extracted.status === 429 || extracted.providerCode === 429)) return true;
    return TRANSIENT_RATE_LIMIT_RE.test(message);
}

// Per-file failure classifier: stable machine code + Croatian display text
// for user-facing surfaces (coverage banner rows, SSE file events). Backend
// logs keep the raw technical message; this translation layer exists so the
// per-file reasons agree with the run-level policy instead of blaming OCR
// for what is really a quota timeout.
//
// Ticket T1-2 codes: timeout | truncation | malformed-json | unreadable-file |
// ocr-failed | daily-quota | rate-limit | unclassified. `schema-mismatch`
// arrives with T1-3 validation. `unclassified` is terminal honesty: used only
// when no class matches, always with the causal chain preserved.
function classifyFileFailure(message) {
    const extracted = isExtracted(message)
        ? message
        : ((message && typeof message === 'object') ? extractProviderError(message) : null);
    const raw = extracted ? extracted.message : String(message || '');

    if (!raw.trim()) {
        return { code: 'unclassified', reason: 'Obrada datoteke nije uspjela.' };
    }
    if (isDailyQuotaExhaustion(extracted || raw)) {
        return { code: 'daily-quota', reason: DAILY_LIMIT_MESSAGE };
    }
    if (isTransientRateLimit(extracted || raw)) {
        return { code: 'rate-limit', reason: TRANSIENT_MESSAGE };
    }
    if (/timed? ?out|deadline|abort/i.test(raw)) {
        return { code: 'timeout', reason: TIMEOUT_MESSAGE };
    }
    if (/truncat|MAX_TOKENS|finish[_-]?reason.{0,24}(MAX_TOKENS|LENGTH)|response[_ -]?truncated|output[_ -]?truncated|prekinut zbog ograničenja/i.test(raw)) {
        return { code: 'truncation', reason: TRUNCATION_MESSAGE };
    }
    if (/non-JSON response|Failed to parse.{0,40}JSON|Unexpected token|is not valid JSON|JSON\.parse|malformed JSON|nije valjani JSON/i.test(raw)) {
        return { code: 'malformed-json', reason: MALFORMED_JSON_MESSAGE };
    }
    if (/schema mismatch|failed schema validation|struktura .* nije valjana/i.test(raw)) {
        return { code: 'schema-mismatch', reason: SCHEMA_MISMATCH_MESSAGE };
    }
    if (/OCR failed/i.test(raw)) {
        return { code: 'ocr-failed', reason: 'OCR čitanje dokumenta nije uspjelo.' };
    }
    if (/could not be parsed|unsupported file type|file not found|no readable text/i.test(raw)) {
        return {
            code: 'unreadable-file',
            reason: 'Datoteka nije mogla biti očitana (nečitljiva ili nepodržanog formata).',
        };
    }
    return { code: 'unclassified', reason: 'Obrada datoteke nije uspjela.' };
}

/**
 * Walks an error's message + `.cause` chain into a bounded, de-duplicated
 * list of causal messages. Survives string errors, Error objects, provider
 * wrappers, and cyclic causes. This is the "causal error chain" the spec
 * requires on every `unclassified` failure (ticket T1-2).
 */
function causalChainOf(error, maxDepth = 5) {
    const chain = [];
    const seen = new Set();
    let current = error;
    for (let depth = 0; depth < maxDepth && current !== null && current !== undefined; depth += 1) {
        let message = null;
        if (typeof current === 'string') {
            message = current;
            current = null;
        } else if (current instanceof Error) {
            message = current.message;
            current = current.cause ?? null;
        } else if (typeof current === 'object') {
            const extracted = isExtracted(current) ? current : extractProviderError(current);
            message = extracted.message || null;
            current = current.cause ?? null;
        } else {
            current = null;
        }
        const text = String(message || '').trim();
        if (text && !seen.has(text)) {
            seen.add(text);
            chain.push(text);
        }
    }
    return chain;
}

/**
 * Full per-file failure record: classifier code + display reason + causal
 * chain. Both `failedFiles` producers (analysis-agent coverage,
 * evidencePackage) must use this so no failure ships without its chain.
 */
function classifyFileFailureDetailed(error) {
    const classified = classifyFileFailure(error);
    return { ...classified, causalChain: causalChainOf(error) };
}

function friendlyAnalysisErrorMessage(error, { stage = null, hasPartial = false } = {}) {
    const extracted = (error && typeof error === 'object') ? extractProviderError(error) : null;
    const raw = extracted ? extracted.message : String(error || '');
    let reason = raw || 'Došlo je do greške u obradi.';

    // CSV export discovery failures carry a stable `reason` on the error; map
    // them to a transparent Croatian message (mirrors classifyFileFailure).
    const csvExportReason = (error && typeof error === 'object' && error.name === 'CsvExportError') ? error.reason : null;
    if (csvExportReason === 'schema-drift' || csvExportReason === 'empty') {
        reason = 'Izvoz podataka e-Oglasne ploče trenutno nije dostupan. Pokušajte ponovno za nekoliko minuta.';
    } else if (csvExportReason === 'http' || csvExportReason === 'network') {
        reason = 'Došlo je do mrežne greške pri dohvaćanju sudskih zapisa. Pokušajte ponovno.';
    } else if (/no results with documents found|nijedan predmet s dostupnim dokumentima/i.test(reason)) {
        reason = 'Nije pronađen nijedan predmet s dostupnim dokumentima za traženi pojam.';
    } else if (/nije pronađen nijedan predmet/i.test(reason)) {
        reason = 'Nije pronađen nijedan predmet za traženi pojam.';
    } else if (isDailyQuotaExhaustion(extracted || reason)) {
        reason = DAILY_LIMIT_MESSAGE;
    } else if (isTransientRateLimit(extracted || reason)) {
        reason = TRANSIENT_MESSAGE;
    } else if (/timed? ?out|ETIMEDOUT|ESOCKETTIMEDOUT|deadline|abort/i.test(reason)) {
        reason = TIMEOUT_MESSAGE;
    } else if (/network|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ERR_INTERNET/i.test(reason)) {
        reason = 'Došlo je do mrežne greške pri povezivanju sa servisom. Pokušajte ponovno.';
    } else if (/failed to launch the browser|browser.?process/i.test(reason)) {
        reason = 'Nije moguće pokrenuti preglednik za dohvat sudskih zapisa.';
    }

    const stageText = describeStage(stage);
    const partialNote = hasPartial
        ? ' Djelomični rezultati su sačuvani i prikazani su niže na ovoj stranici.'
        : '';

    return `Analiza nije uspjela tijekom faze ${stageText}. ${reason}${partialNote}`;
}

module.exports = {
    STAGE_LABELS,
    describeStage,
    friendlyAnalysisErrorMessage,
    isDailyQuotaExhaustion,
    isTransientRateLimit,
    classifyFileFailure,
    classifyFileFailureDetailed,
    causalChainOf,
    extractProviderError,
    DAILY_LIMIT_MESSAGE,
    TRANSIENT_MESSAGE,
    TIMEOUT_MESSAGE,
    MALFORMED_JSON_MESSAGE,
    TRUNCATION_MESSAGE,
    SCHEMA_MISMATCH_MESSAGE
};
