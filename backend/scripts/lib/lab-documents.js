'use strict';

const OIB_CASE_DOCS = [
    { docId: '1:Podnesak.pdf', role: 'Current procedural filing', pages: 2, textChars: 3452, layer: 'text', complexity: 'low', evidence: 'Two pages; numbered content and two OIB-like identifiers.' },
    { docId: '6:Prilog St-2_2013-1208-1 - Račun Adria Rijeka 2-2025 (1).pdf', role: 'Invoice exhibit', pages: 1, textChars: 0, layer: 'image', complexity: 'medium', evidence: 'One-page image-only financial exhibit; OCR must recover printed figures.' },
    { docId: '10:Troškovnik.pdf', role: 'Cost schedule', pages: 2, textChars: 3005, layer: 'text', complexity: 'high', evidence: 'Two-page itemized cost table with money and party identifiers.' },
    { docId: '2:Žalba.pdf', role: 'Appeal', pages: 5, textChars: 16380, layer: 'text', complexity: 'medium', evidence: 'Five pages; dates, amounts, and structured argument.' },
    { docId: '4:Rješenje - odbijen prigovor na diobeni popis.pdf', role: 'Decision on objection', pages: 7, textChars: 19748, layer: 'text', complexity: 'high', evidence: 'Seven pages; disposition, parties, many identifiers and financial references.' },
    { docId: '8:Rješenje - odbijena žalba kao neosnovana - potvrđeno rješenje 1.st..pdf', role: 'Appellate ruling', pages: 6, textChars: 13693, layer: 'text', complexity: 'high', evidence: 'Six pages; procedural result and cross-referenced first-instance ruling.' },
    { docId: '19:Diobeni popis.pdf', role: 'Distribution schedule', pages: 12, textChars: 24788, layer: 'text', complexity: 'very high', evidence: 'Twelve pages; hundreds of numeric row-like lines and many OIBs.' },
    { docId: '19:Završni račun.pdf', role: 'Final account', pages: 39, textChars: 90248, layer: 'text', complexity: 'very high', evidence: 'Thirty-nine pages; long chronological account with dense numeric rows.' },
    { docId: '26:Prilog St-2_2013-1159-2 - Prilog 2. - Specifikacija djelomičnog namirenja tražbine B2 KAPITAL d.o.o..pdf', role: 'Partial settlement specification', pages: 1, textChars: 0, layer: 'image', complexity: 'high', evidence: 'One-page image-only partial payment specification.' },
    { docId: '27:Prilog St-2_2013-1155-1 - Ugovor o ustupu tražbina.pdf', role: 'Assignment agreement', pages: 11, textChars: 26388, layer: 'text', complexity: 'very high', evidence: 'Eleven pages; lifecycle terms, many amounts, dates, and identifiers.' },
    { docId: '372:kerum.pdf', role: 'Other-case appeal scan (St-357/2013)', pages: 3, textChars: 4, layer: 'image', complexity: 'medium', evidence: 'Three-page scanned appeal in related case St-357/2013; empty PDF text layer.' },
    { docId: '374:kerum.pdf', role: 'Other-case appellate ruling scan (Stpn-7/2017)', pages: 5, textChars: 8, layer: 'image', complexity: 'high', evidence: 'Five-page scanned VTS RH ruling (Pž-1600/2018-2) in Stpn-7/2017; empty PDF text layer.' },
    { docId: '379:4 Stpn-7-2017.pdf', role: 'Other-case VTS ruling scan (Stpn-7/2017)', pages: 4, textChars: 6, layer: 'image', complexity: 'high', evidence: 'Four-page scanned VTS RH ruling (Pž-7788/2016) in 4 Stpn-7/2017; empty PDF text layer.' },
    { docId: '367:32303648.pdf', role: 'Other-case summary bankruptcy request scan (St-794/2018)', pages: 2, textChars: 2, layer: 'image', complexity: 'medium', evidence: 'Two-page scanned FINA summary bankruptcy request in St-794/2018; empty PDF text layer.' },
    { docId: '322:KERUM.pdf', role: 'Trustee report scan (2019)', pages: 4, textChars: 6, layer: 'image', complexity: 'high', evidence: 'Four-page scanned 2019 trustee report in St-2/2013; empty PDF text layer.' },
    { docId: '40:Prilog St-2_2013-1128-1 - Zapisnik prodaja Stari Grad 31032025.pdf', role: 'Auction minutes scan (Stari Grad)', pages: 1, textChars: 0, layer: 'image', complexity: 'medium', evidence: 'One-page scanned and hand-signed court auction minutes from 31.03.2025.' },
    { docId: '38:Prilog St-2_2013-1133-1 - Kerum oglas Sl Dalm 16052025.pdf', role: 'Newspaper auction clipping scan', pages: 1, textChars: 0, layer: 'image', complexity: 'high', evidence: 'One-page two-column Slobodna Dalmacija newspaper sale notice scan with EUR prices and dates.' },
    { docId: '38:Prilog St-2_2013-1133-7 - Kerum FINA 19052025 Stari Grad.pdf', role: 'Handwritten FINA registry request scan', pages: 1, textChars: 0, layer: 'image', complexity: 'high', evidence: 'One-page handwritten and stamped FINA property sale registration form for Stari Grad.' },
    { docId: '52:Prilog St-2_2013-1099-1 - Kerum izvod 51 241230-2340009-1190027245-051000EUR.pdf', role: 'Bank statement (EUR izvod)', pages: 1, textChars: 1957, layer: 'text', complexity: 'high', evidence: 'One-page digital PBZ EUR bank statement (izvod 51) table with IBAN, dates, and transaction rows.' },
    { docId: '151:Prilog St-2_2013-837-1 - Kerum doo izvod 59 221005-2340009-1190027245-059000HRK.pdf', role: 'Bank statement (HRK izvod)', pages: 1, textChars: 1736, layer: 'text', complexity: 'high', evidence: 'One-page digital PBZ HRK bank statement (izvod 59) table with IBAN, dates, and transaction rows.' },
    { docId: '19:Prilog St-2_2013-1175-2 - Iznosi tražbina i troškova postupka na dan 13.10.2025. u 15_27 sati.pdf', role: 'Claim totals and cost table', pages: 1, textChars: 1189, layer: 'text', complexity: 'medium', evidence: 'One-page digital claim totals and procedural costs table for St-2/2013 as of 13.10.2025.' },
    { docId: '43:Rješenje - prihvaćena žalba - ukinuto 1. st. rješenje.pdf', role: 'Appellate reversal ruling', pages: 5, textChars: 13055, layer: 'text', complexity: 'high', evidence: 'Five-page VTS RH appellate ruling (Pž-674/2025-2) overturning and remanding first-instance decision.' },
    { docId: '66:Rješenje - o namirenju.pdf', role: 'Creditor settlement ruling', pages: 6, textChars: 13823, layer: 'text', complexity: 'high', evidence: 'Six-page settlement distribution ruling (St-2/2013-1062) with EUR disbursement breakdown.' },
    { docId: '73:Rješenje - dosuda.pdf', role: 'Real estate adjudication ruling', pages: 5, textChars: 11770, layer: 'text', complexity: 'high', evidence: 'Five-page adjudication ruling (St-2/2013-1046) awarding property to buyer with price and parcel IDs.' },
    { docId: '186:Rješenje - utvrđene i osporene tražbine.pdf', role: 'Claim determination ruling', pages: 4, textChars: 5137, layer: 'text', complexity: 'high', evidence: 'Four-page claim determination ruling (4. St-2/2013-747) establishing creditor claims in HRK.' },
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
const FULL_PILOT_MAX = 30;

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

module.exports = { OIB_CASE_DOCS, SMOKE_DOC_IDS, FULL_PILOT_MIN, FULL_PILOT_MAX, assertRunScope };
