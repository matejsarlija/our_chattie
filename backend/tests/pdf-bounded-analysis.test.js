const { PDFDocument } = require('pdf-lib');
const { shouldBoundAnalysis, runBoundedAnalysis } = require('../scripts/lib/bounded-analysis');

const json = value => ({ response:{ choices:[{message:{content:JSON.stringify(value)}}]}, cost:0.01, usage:{input_tokens:10}, status:200, latencyMs:5 });

describe('bounded analysis', () => {
    it('covers dense text with original chunk offsets and merges all facts', async () => {
        const text = 'A'.repeat(13000);
        const calls = [];
        const result = await runBoundedAnalysis({ doc:{id:'dense'}, context:{}, sourceText:text,
            requestText: async (chunk, segment) => { calls.push({chunk, segment}); return json({amounts:[{quote:'fact '+segment.startIndex, amount:1}]}); } });
        expect(result.analysisSegmentation.status).toBe('completed');
        expect(calls[0].segment.startIndex).toBe(0);
        expect(calls.at(-1).segment.endIndex).toBe(text.length);
        expect(result.analysisSegmentation.segments.every(s => s.status === 'completed')).toBe(true);
        expect(JSON.parse(result.response.choices[0].message.content).amounts).toHaveLength(calls.length);
        expect(result.cost).toBeCloseTo(calls.length * 0.01);
    });

    it('preserves pages and original ordering in one-page PDF requests', async () => {
        const source = await PDFDocument.create();
        for (let i=0;i<3;i++) source.addPage([200+i,200]);
        const bytes = Buffer.from(await source.save());
        const seen = [];
        const result = await runBoundedAnalysis({ doc:{}, context:{}, pdfBytes:bytes,
            requestPdf: async (one, segment) => { const loaded=await PDFDocument.load(one); seen.push([segment.pageNumbers[0],loaded.getPageCount(),loaded.getPage(0).getWidth()]); return json({summary:String(segment.pageNumbers[0])}); } });
        expect(seen).toEqual([[1,1,200],[2,1,201],[3,1,202]]);
        expect(result.analysisSegmentation.status).toBe('completed');
    });

    it('rejects malformed and truncated output without an aggregate', async () => {
        const malformed = json({});
        malformed.response.choices[0].message.content = '{"x":';
        for (const raw of [malformed, {...json({}),finish_reason:'length'}]) {
            const result = await runBoundedAnalysis({doc:{},context:{},sourceText:'short',requestText:async()=>raw});
            expect(result.response).toBeNull();
            expect(result.analysisSegmentation.status).toBe('failed');
        }
    });

    it('halts after an unknown-cost failure and retains known subtotal', async () => {
        let calls=0;
        const result = await runBoundedAnalysis({doc:{},context:{},sourceText:'x'.repeat(8000),
            requestText:async()=>{ calls++; if(calls===1) return {...json({}),cost:0.2}; const e=new Error('timeout'); e.rawResult={cost:null,status:504}; throw e; } });
        expect(calls).toBe(2);
        expect(result.cost).toBeCloseTo(0.2);
        expect(result.costIncomplete).toBe(true);
        expect(result.response).toBeNull();
    });

    it('stops after intermediate cap breach but retains a fully completed final result', async () => {
        let calls=0;
        const opts={doc:{},context:{recordRequest:()=>false},sourceText:'x'.repeat(8000),requestText:async()=>{calls++;return {...json({summary:'ok'}),cost:0.02};}};
        const stopped=await runBoundedAnalysis(opts);
        expect(stopped.response).toBeNull();
        expect(calls).toBe(1);
        const final=await runBoundedAnalysis({...opts,sourceText:'small'});
        expect(final.response).not.toBeNull();
        expect(final.usage.input_tokens).toBe(10);
    });
});

test('bounded merging removes overlap duplicates but preserves equal facts in distinct source ranges', async () => {
    const chars = Array(13000).fill('x');
    const overlapQuote = 'OVERLAP_EUR17';
    const repeatedQuote = 'DISTINCT_EUR29';
    for (const [offset, quote] of [[3200, overlapQuote], [100, repeatedQuote], [9000, repeatedQuote]]) chars.splice(offset, quote.length, ...quote);
    const sourceText = chars.join('');
    const result = await runBoundedAnalysis({
        doc: { docId: 'source' }, sourceText,
        requestText: async text => json({
            amounts: [
                ...(text.includes(overlapQuote) ? [{ amount: 17, quote: overlapQuote }] : []),
                ...(text.includes(repeatedQuote) ? [{ amount: 29, quote: repeatedQuote }] : []),
            ],
        }),
    });
    const merged = JSON.parse(result.response.choices[0].message.content);
    expect(merged.amounts.filter(fact => fact.amount === 17)).toHaveLength(1);
    const repeated = merged.amounts.filter(fact => fact.amount === 29);
    expect(repeated).toHaveLength(2);
    expect(repeated[0].sourceEndIndex).toBeLessThan(repeated[1].sourceStartIndex);
});

test('single analysis mode takes precedence over dense/long workload detection', () => {
    const doc = { pages: 12, tableHeavy: true };
    expect(shouldBoundAnalysis(doc, { analysisMode: 'single' }, 'x'.repeat(13000))).toBe(false);
    expect(shouldBoundAnalysis(doc, { analysisMode: 'bounded' }, 'x'.repeat(13000))).toBe(true);
});
