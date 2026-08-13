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

function friendlyAnalysisErrorMessage(error, { stage = null, hasPartial = false } = {}) {
    const raw = (error && typeof error === 'object' && error.message) ? error.message : String(error || '');
    let reason = raw || 'Došlo je do greške u obradi.';

    if (/no results with documents found|nijedan predmet s dostupnim dokumentima/i.test(reason)) {
        reason = 'Nije pronađen nijedan predmet s dostupnim dokumentima za traženi pojam.';
    } else if (/nije pronađen nijedan predmet/i.test(reason)) {
        reason = 'Nije pronađen nijedan predmet za traženi pojam.';
    } else if (/resource has been exhausted|quota|429|rate.?limit/i.test(reason)) {
        reason = 'Dnevni limit AI analize je iscrpljen. Pokušajte ponovno sutra ili s manjim brojem predmeta.';
    } else if (/timed? ?out|ETIMEDOUT|ESOCKETTIMEDOUT|deadline|abort/i.test(reason)) {
        reason = 'Zahtjev AI servisu je premašio dopušteno vrijeme čekanja i automatski je prekinut. Pokušajte ponovno; na besplatnom AI planu uzrok je često iscrpljeni dnevni limit.';
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
    friendlyAnalysisErrorMessage
};
