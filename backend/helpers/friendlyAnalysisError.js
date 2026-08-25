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

function describeStage(stage) {
    return STAGE_LABELS[stage] || 'obrade zahtjeva';
}

// Two-class 429 policy (paid key only — the free tier is no longer supported):
// - Daily quota exhaustion is terminal: retrying burns the remaining budget
//   and never succeeds, so surface the day-level limit.
// - A rate-limit/timeout is a transient RPM/TPM burst that recovers with
//   backoff; the message must NOT claim the daily limit.
const DAILY_QUOTA_RE =
    /resource has been exhausted|requests[_ -]?per[_-]?day|quota.*(daily|per.?day|exhausted)|dnevni limit|daily limit|limit.*per day|exceeded.*daily/i;
const TRANSIENT_RATE_LIMIT_RE =
    /\b429\b|rate[ _-]?limit|too many requests|overloaded|temporarily (unavailable|overloaded)|rpm|tpm|requests[_ -]?per[_-]?(second|minute|token|character)/i;

function isDailyQuotaExhaustion(reason) {
    return DAILY_QUOTA_RE.test(reason);
}

function isTransientRateLimit(reason) {
    return TRANSIENT_RATE_LIMIT_RE.test(reason) && !isDailyQuotaExhaustion(reason);
}

// Per-file failure classifier: stable machine code + Croatian display text
// for user-facing surfaces (coverage banner rows, SSE file events). Backend
// logs keep the raw technical message; this translation layer exists so the
// per-file reasons agree with the run-level policy instead of blaming OCR
// for what is really a quota timeout.
function classifyFileFailure(message) {
    const raw = String(message || '');

    if (!raw.trim()) {
        return { code: 'unknown', reason: 'Obrada datoteke nije uspjela.' };
    }
    if (isDailyQuotaExhaustion(raw)) {
        return { code: 'daily-quota', reason: DAILY_LIMIT_MESSAGE };
    }
    if (isTransientRateLimit(raw)) {
        return { code: 'rate-limit', reason: TRANSIENT_MESSAGE };
    }
    if (/timed? ?out|deadline|abort/i.test(raw)) {
        return { code: 'timeout', reason: TIMEOUT_MESSAGE };
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
    return { code: 'unknown', reason: 'Obrada datoteke nije uspjela.' };
}

function friendlyAnalysisErrorMessage(error, { stage = null, hasPartial = false } = {}) {
    const raw = (error && typeof error === 'object' && error.message) ? error.message : String(error || '');
    let reason = raw || 'Došlo je do greške u obradi.';

    if (/no results with documents found|nijedan predmet s dostupnim dokumentima/i.test(reason)) {
        reason = 'Nije pronađen nijedan predmet s dostupnim dokumentima za traženi pojam.';
    } else if (/nije pronađen nijedan predmet/i.test(reason)) {
        reason = 'Nije pronađen nijedan predmet za traženi pojam.';
    } else if (isDailyQuotaExhaustion(reason)) {
        reason = DAILY_LIMIT_MESSAGE;
    } else if (isTransientRateLimit(reason)) {
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
    DAILY_LIMIT_MESSAGE,
    TRANSIENT_MESSAGE,
    TIMEOUT_MESSAGE
};
