'use strict';

const crypto = require('crypto');
const { stableShuffle, stratify } = require('./selection');

function numericSeed(seed) {
    return Number.parseInt(crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 8), 16);
}

function groupCandidates(rows) {
    const docs = new Map();
    for (const row of rows || []) {
        if ((row.repeat || 1) !== 1) continue;
        if (!docs.has(row.docId)) docs.set(row.docId, { docId: row.docId, title: row.title || row.docId, documentType: row.documentType || 'unknown', candidates: [] });
        docs.get(row.docId).candidates.push(row);
    }
    return [...docs.values()];
}

function selectReviewDocs(rows, { sample = 0, seed = 1 } = {}) {
    const docs = groupCandidates(rows);
    const spreadDocs = [];
    const failures = [];
    const latencies = docs.flatMap((doc) => doc.candidates.map((row) => row.latency).filter(Number.isFinite)).sort((a, b) => a - b);
    const p95 = latencies.length ? latencies[Math.ceil(latencies.length * 0.95) - 1] : Infinity;
    const outliers = [];
    for (const doc of docs) {
        const recalls = doc.candidates.map((row) => row.metrics?.amounts?.recall ?? row.goldAccuracy?.amounts?.recall).filter(Number.isFinite);
        const spread = recalls.length > 1 ? Math.max(...recalls) - Math.min(...recalls) : 0;
        if (spread > 0) spreadDocs.push({ doc, spread });
        if (doc.candidates.some((row) => row.errors?.length)) failures.push(doc);
        if (doc.candidates.some((row) => Number.isFinite(row.latency) && row.latency >= p95 && p95 < Infinity)) outliers.push(doc);
    }
    spreadDocs.sort((a, b) => b.spread - a.spread || a.doc.docId.localeCompare(b.doc.docId));
    const chosen = new Map();
    const add = (doc, reason) => {
        const entry = chosen.get(doc.docId) || { ...doc, selectionReasons: [] };
        if (!entry.selectionReasons.includes(reason)) entry.selectionReasons.push(reason);
        chosen.set(doc.docId, entry);
    };
    for (const { doc } of spreadDocs) add(doc, 'cross-method variation');
    for (const doc of failures) add(doc, 'recorded processing issue');
    for (const doc of outliers) add(doc, 'unusual processing observation');
    if (sample > 0) {
        const unselected = docs.filter((doc) => !chosen.has(doc.docId));
        const stratifiedGroups = stratify(unselected);
        const shuffledGroups = [...stratifiedGroups.entries()].map(([key, values]) => [key, stableShuffle(values, numericSeed(`${seed}:${key}`))]);
        let round = 0;
        let count = 0;
        while (count < sample) {
            let added = false;
            for (const [, values] of shuffledGroups) {
                if (!values[round]) continue;
                add(values[round], 'stratified review sample');
                count += 1;
                added = true;
                if (count >= sample) break;
            }
            if (!added) break;
            round += 1;
        }
    }
    return [...chosen.values()];
}

function shuffleCandidateLabels(candidates, seed, docId) {
    const shuffled = stableShuffle(candidates, numericSeed(`${seed}:${docId}`));
    return shuffled.map((candidate, index) => ({ ...candidate, label: String.fromCharCode(65 + index) }));
}


function makeReviewData(selectedDocs, imagesByDoc, seed = 1) {
    const answerKey = {};
    const viewDocs = selectedDocs.map((doc) => {
        const candidates = shuffleCandidateLabels(doc.candidates, seed, doc.docId);
        answerKey[doc.docId] = Object.fromEntries(candidates.map((item) => [item.label, { arm: item.arm, model: item.model || null, repeat: item.repeat || 1 }]));
        return {
            docId: doc.docId,
            title: doc.title,
            documentType: doc.documentType,
            selectionReasons: doc.selectionReasons,
            images: imagesByDoc[doc.docId] || [],
            referenceText: doc.candidates.find((item) => item.arm === 'local-text')?.text || '',
            candidates: candidates.map((item) => ({ label: item.label, text: item.text || '', failed: Boolean(item.errors?.length) })),
        };
    });
    return { viewDocs, answerKey };
}

function buildReviewHtml(viewDocs) {
    const payload = JSON.stringify(viewDocs).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline document review</title>
<style>
:root{color-scheme:light dark;font:16px/1.5 system-ui,sans-serif}body{max-width:1200px;margin:auto;padding:1rem;color:CanvasText;background:Canvas}h1{font-size:1.5rem}.banner{padding:1rem;border:2px solid #8a4b00;background:#fff3d6;color:#301b00;font-weight:700}.doc{border-top:2px solid #888;padding:1.25rem 0}.reason{color:#555}.grid{display:grid;grid-template-columns:minmax(260px,1fr) minmax(320px,2fr);gap:1rem;margin:1rem 0}.pages img{display:block;max-width:100%;height:auto;margin:0 0 .75rem;border:1px solid #888}.candidate{border:1px solid #777;border-radius:.4rem;padding:1rem;margin:.75rem 0}.transcript{white-space:pre-wrap;overflow-wrap:anywhere;max-height:60vh;overflow:auto}.diff{background:#ffe08a;color:#211400}.field{display:block;margin:.6rem 0}textarea{width:100%;min-height:5rem}button,select{font:inherit;padding:.4rem}.candidate-head{font-weight:700}.error{color:#a00;font-weight:700}@media(max-width:760px){.grid{grid-template-columns:1fr}}
</style></head><body><header><h1>Blinded court-analysis review</h1><p class="banner">Contains court-document images. Local use only; do not share this file.</p><p>Judge each candidate analysis against the source page. Highlights mark differences from the text-only candidate or text common across candidates; they are navigation aids, not errors.</p></header><main id="review"></main><button id="export">Download verdicts JSON</button>
<script>
const DATA=${payload};
const root=document.getElementById('review');
const verdicts=[];
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function tokens(s){return new Set((s.match(/[\\p{L}\\p{N}]+/gu)||[]).map(x=>x.toLocaleLowerCase()))}
for(const doc of DATA){
 const section=document.createElement('section');section.className='doc';section.innerHTML='<h2>'+esc(doc.title)+'</h2><p>'+esc(doc.documentType)+'</p><p class="reason">Selection: '+esc(doc.selectionReasons.join('; '))+'</p>';
 const tokenCounts=new Map();for(const c of doc.candidates)for(const t of tokens(c.text))tokenCounts.set(t,(tokenCounts.get(t)||0)+1);
 for(const c of doc.candidates){
  const pair=document.createElement('div');pair.className='grid';const pages=document.createElement('div');pages.className='pages';
  for(const image of doc.images){const img=document.createElement('img');img.src=image.dataUri;img.alt='Page '+image.pageNumber;pages.appendChild(img)}
  const box=document.createElement('article');box.className='candidate';box.dataset.label=c.label;const header=document.createElement('div');header.className='candidate-head';header.textContent='Candidate '+c.label+(c.failed?' — recorded processing issue':'');if(c.failed)header.classList.add('error');box.appendChild(header);
  const transcript=document.createElement('div');transcript.className='transcript';
  const sourceTokens=tokens(doc.referenceText||'');const parts=(c.text||'').split(/([\\p{L}\\p{N}]+)/gu);for(const part of parts){if(/[\\p{L}\\p{N}]+/u.test(part)&&(!sourceTokens.has(part.toLocaleLowerCase())||(tokenCounts.get(part.toLocaleLowerCase())||0)<doc.candidates.length)){const mark=document.createElement('mark');mark.className='diff';mark.textContent=part;transcript.appendChild(mark)}else transcript.appendChild(document.createTextNode(part))}
  if(!c.text)transcript.textContent='[No transcript returned]';box.appendChild(transcript);
  const verdict=document.createElement('select');verdict.className='verdict';verdict.setAttribute('aria-label','Candidate '+c.label+' verdict');verdict.innerHTML='<option value="">Choose verdict</option><option value="usable">Usable</option><option value="not usable">Not usable</option>';const verdictLabel=document.createElement('label');verdictLabel.className='field';verdictLabel.append('Verdict ',verdict);box.appendChild(verdictLabel);
  const errors=document.createElement('select');errors.className='errors';errors.setAttribute('aria-label','Candidate '+c.label+' error type');errors.innerHTML='<option value="">No error type</option>'+['dropped row','merged columns','wrong digit','lost page','hallucinated text','diacritics','other'].map(v=>'<option>'+esc(v)+'</option>').join('');const errorLabel=document.createElement('label');errorLabel.className='field';errorLabel.append('Error type ',errors);box.appendChild(errorLabel);
  const notes=document.createElement('textarea');notes.className='notes';notes.setAttribute('aria-label','Candidate '+c.label+' notes');notes.placeholder='Notes';const notesLabel=document.createElement('label');notesLabel.className='field';notesLabel.append('Notes ',notes);box.appendChild(notesLabel);
  pair.appendChild(pages);pair.appendChild(box);section.appendChild(pair);verdicts.push({docId:doc.docId,label:c.label,verdict,errors,notes});
 }
 root.appendChild(section);
}
document.getElementById('export').addEventListener('click',()=>{const output=verdicts.map(v=>({docId:v.docId,label:v.label,verdict:v.verdict.value||null,errorTypes:v.errors.value?[v.errors.value]:[],notes:v.notes.value}));const blob=new Blob([JSON.stringify({verdicts:output},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='review-verdicts.json';a.click();URL.revokeObjectURL(a.href)});
</script></body></html>`;
}

module.exports = { groupCandidates, selectReviewDocs, shuffleCandidateLabels, makeReviewData, buildReviewHtml };
