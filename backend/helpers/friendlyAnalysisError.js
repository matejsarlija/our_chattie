const STAGE_LABELS = {
    discovering: 'pronalaženja objava',
    grouping: 'grupiranja pronađenih predmeta',
    downloading: 'preuzimanja dokumenata',
    extracting: 'raspakiravanja dokumenata',
    reasoning: 'analize i sintetiziranja izvješća',
    verifying: 'provjere nalaza',
    complete: 'završetka obrade'
};

function describeStage(stage) {
    return STAGE_LABELS[stage] || 'obrade zahtjeva';
}

// Two-class 429 policy:
// - Daily quota exhaustion is terminal: retrying burns the remaining budget and
//   never succeeds, so surface the day-level limit message immediately.
// - Transient rate-limit (RPM/TPM burst) on a paid key is recoverable with
//   retry-and-backoff; the friendly message must NOT claim the daily limit.
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

function friendlyAnalysisErrorMessage(error, { stage = null, hasPartial = false } = {}) {
    const raw = (error && typeof error === 'object' && error.message) ? error.message : String(error || '');
    let reason = raw || 'Došlo je do greške u obradi.';

    if (/no results with documents found|nijedan predmet s dostupnim dokumentima/i.test(reason)) {
        reason = 'Nije pronađen nijedan predmet s dostupnim dokumentima za traženi pojam.';
    } else if (/nije pronađen nijedan predmet/i.test(reason)) {
        reason = 'Nije pronađen nijedan predmet za traženi pojam.';
    } else if (isDailyQuotaExhaustion(reason)) {
        reason = 'Dnevni limit AI analize je iscrpljen. Pokušajte ponovno sutra ili s manjim brojem predmeta.';
    } else if (isTransientRateLimit(reason)) {
        reason = 'AI servis je trenutno preopterećen (privremeno ograničenje učestalosti zahtjeva). Pokušajte ponovno za nekoliko minuta.';
    } else if (/timed? ?out|ETIMEDOUT|ESOCKETTIMEDOUT|deadline|abort/i.test(reason)) {
        reason = 'Zahtjev AI servisu je premašio dopušteno vrijeme čekanja i automatski je prekinut. Pokušajte ponovno; na besplatnom AI planu uzrok je često iscrpljeni dnevni limit, a na plaćenom privremeni raskorak u učestalosti zahtjeva.';
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
    isTransientRateLimit
};
