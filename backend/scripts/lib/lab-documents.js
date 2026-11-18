'use strict';

const OIB_CASE_DOCS = [
    { docId: '1:Podnesak.pdf', role: 'Current procedural filing', pages: 2, textChars: 3452, layer: 'text', complexity: 'low', evidence: 'Two pages; numbered content and two OIB-like identifiers.' },
    { docId: '2:Žalba.pdf', role: 'Appeal', pages: 5, textChars: 16380, layer: 'text', complexity: 'medium', evidence: 'Five pages; dates, amounts, and structured argument.' },
    { docId: '4:Rješenje - odbijen prigovor na diobeni popis.pdf', role: 'Decision on objection', pages: 7, textChars: 19748, layer: 'text', complexity: 'high', evidence: 'Seven pages; disposition, parties, many identifiers and financial references.' },
    { docId: '5:Prijedlog.pdf', role: 'Short proposal', pages: 1, textChars: 2298, layer: 'text', complexity: 'low', evidence: 'One-page procedural baseline.' },
    { docId: '6:Prilog St-2_2013-1208-1 - Račun Adria Rijeka 2-2025 (1).pdf', role: 'Invoice exhibit', pages: 1, textChars: 0, layer: 'image', complexity: 'medium', evidence: 'One-page image-only financial exhibit; OCR must recover printed figures.' },
    { docId: '8:Rješenje - odbijena žalba kao neosnovana - potvrđeno rješenje 1.st..pdf', role: 'Appellate ruling', pages: 6, textChars: 13693, layer: 'text', complexity: 'high', evidence: 'Six pages; procedural result and cross-referenced first-instance ruling.' },
    { docId: '10:Troškovnik.pdf', role: 'Cost schedule', pages: 2, textChars: 3005, layer: 'text', complexity: 'high', evidence: 'Two-page itemized cost table with money and party identifiers.' },
    { docId: '10:Prilog St-2_2013-1196-1 - CroGo-Kerum_I°-2.pdf', role: 'Claim and cost exhibit', pages: 7, textChars: 19679, layer: 'text', complexity: 'high', evidence: 'Seven pages; dense amounts, dates, and tabular rows.' },
    { docId: '18:Prigovor.pdf', role: 'Objection', pages: 3, textChars: 10314, layer: 'text', complexity: 'high', evidence: 'Three pages; legal argument with frequent financial references.' },
    { docId: '19:Diobeni popis.pdf', role: 'Distribution schedule', pages: 12, textChars: 24788, layer: 'text', complexity: 'very high', evidence: 'Twelve pages; hundreds of numeric row-like lines and many OIBs.' },
    { docId: '19:Završni račun.pdf', role: 'Final account', pages: 39, textChars: 90248, layer: 'text', complexity: 'very high', evidence: 'Thirty-nine pages; long chronological account with dense numeric rows.' },
    { docId: '19:Prilog St-2_2013-1175-1 - Kerum doo u stečaju Iznosi tražbina i troškova postupka.pdf', role: 'Claim totals exhibit', pages: 1, textChars: 0, layer: 'image', complexity: 'high', evidence: 'One-page image-only claims/expenses table.' },
    { docId: '26:Prilog St-2_2013-1159-2 - Prilog 2. - Specifikacija djelomičnog namirenja tražbine B2 KAPITAL d.o.o..pdf', role: 'Partial settlement specification', pages: 1, textChars: 0, layer: 'image', complexity: 'high', evidence: 'One-page image-only partial payment specification.' },
    { docId: '27:Podnesak.pdf', role: 'Claim-transfer filing', pages: 2, textChars: 2547, layer: 'text', complexity: 'medium', evidence: 'Two pages; transfer event, dates, and party identifiers.' },
    { docId: '27:Prilog St-2_2013-1155-1 - Ugovor o ustupu tražbina.pdf', role: 'Assignment agreement', pages: 11, textChars: 26388, layer: 'text', complexity: 'very high', evidence: 'Eleven pages; lifecycle terms, many amounts, dates, and identifiers.' },
    { docId: '29:Prilog St-2_2013-1153-4 - IOS.pdf', role: 'Open-item statement exhibit', pages: 1, textChars: 0, layer: 'image', complexity: 'high', evidence: 'One-page image-only account statement; OCR/table-layout stress case.' },
];

// Fixed three-document trio for the live smoke run: one plain text filing, one
// image-only exhibit, one dense table. Five pages total keeps a paid end-to-end
// check of every arm cheap, and pinning the IDs keeps smoke runs comparable.
const SMOKE_DOC_IDS = [
    '1:Podnesak.pdf',
    '6:Prilog St-2_2013-1208-1 - Račun Adria Rijeka 2-2025 (1).pdf',
    '10:Troškovnik.pdf',
];

const FULL_PILOT_MIN = 12;
const FULL_PILOT_MAX = 20;

function assertRunScope({ docs, smokeRun, dryRun }) {
    if (!Array.isArray(docs) || !docs.length) throw new Error('Select at least one fixture document.');
    if (dryRun) return;
    if (smokeRun) {
        const selected = new Set(docs.map((doc) => doc.docId));
        const isTrio = selected.size === SMOKE_DOC_IDS.length && SMOKE_DOC_IDS.every((id) => selected.has(id));
        if (!isTrio) throw new Error(`The live smoke run uses exactly the fixed 3-document trio (${SMOKE_DOC_IDS.map((id) => id.slice(id.indexOf(':') + 1)).join(', ')}).`);
        return;
    }
    if (docs.length < FULL_PILOT_MIN || docs.length > FULL_PILOT_MAX) throw new Error(`A full benchmark pilot must contain ${FULL_PILOT_MIN}–${FULL_PILOT_MAX} documents.`);
}

module.exports = { OIB_CASE_DOCS, SMOKE_DOC_IDS, assertRunScope };
