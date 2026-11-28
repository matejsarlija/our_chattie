import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import DashboardShell from '../Dashboard/DashboardShell';
import Button from '../ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import Input from '../ui/Input';
import Badge from '../ui/Badge';
import StatusBadge from '../ui/StatusBadge';
import Callout from '../ui/Callout';
import Dialog from '../ui/Dialog';
import Sheet from '../ui/Sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/Tabs';
import PipelinePhases from '../ui/PipelinePhases';
import CoverageCell from '../ui/CoverageCell';
import AmountCell from '../ui/AmountCell';
import LifecycleTimeline from '../ui/LifecycleTimeline';

const SURFACE_TOKENS = [
  { name: '--bg', utility: 'bg-bg', hex: '#f8f9fa', note: 'Pozadina stranice', previewClass: 'bg-bg border border-line' },
  { name: '--surface', utility: 'bg-surface', hex: '#ffffff', note: 'Kartica / panel', previewClass: 'bg-surface border border-line' },
  { name: '--surface-muted', utility: 'bg-surface-muted', hex: '#eef0f3', note: 'Zaglavlje tablice, pločica', previewClass: 'bg-surface-muted border border-line' },
  { name: '--ink', utility: 'text-ink', hex: '#141821', note: 'Primarni tekst (17.76:1)', previewClass: 'bg-ink' },
  { name: '--ink-muted', utility: 'text-ink-muted', hex: '#4b5563', note: 'Sekundarni tekst (7.56:1)', previewClass: 'bg-ink-muted' },
  { name: '--line', utility: 'border-line', hex: '#dde1e6', note: 'Dekorativni obrub (1.31:1)', previewClass: 'bg-surface border-2 border-line' },
  { name: '--line-control', utility: 'border-line-control', hex: '#6b7280', note: 'Kontrolni obrub (4.83:1)', previewClass: 'bg-surface border-2 border-line-control' },
  { name: '--accent', utility: 'bg-accent / text-accent', hex: '#1d4ed8', note: 'Jedini akcent (6.70:1)', previewClass: 'bg-accent' },
];

const STATUS_TOKENS = [
  {
    name: 'Success',
    fgVar: '--success',
    bgVar: '--success-surface',
    fg: 'text-success',
    bg: 'bg-success-surface',
    fgHex: '#166534',
    bgHex: '#eefaf1',
    label: 'Potvrđeno',
  },
  {
    name: 'Warning',
    fgVar: '--warning',
    bgVar: '--warning-surface',
    fg: 'text-warning',
    bg: 'bg-warning-surface',
    fgHex: '#92600a',
    bgHex: '#fdf6e7',
    label: 'Upozorenje',
  },
  {
    name: 'Danger',
    fgVar: '--danger',
    bgVar: '--danger-surface',
    fg: 'text-danger',
    bg: 'bg-danger-surface',
    fgHex: '#b3261e',
    bgHex: '#fdf0ef',
    label: 'Greška',
  },
  {
    name: 'Info',
    fgVar: '--info',
    bgVar: '--info-surface',
    fg: 'text-info',
    bg: 'bg-info-surface',
    fgHex: '#1d4ed8',
    bgHex: '#eef2ff',
    label: 'U tijeku',
  },
];

const RUN_STATUSES = ['done', 'running', 'queued', 'partial', 'interrupted', 'canceled', 'error', 'unknown'];

const SAMPLE_STAGES = [
  { key: 'queued', label: 'Zaprimljeno', completed: true, active: false },
  { key: 'starting', label: 'Pokretanje', completed: true, active: false },
  { key: 'discovering', label: 'Pronalaženje', completed: true, active: false },
  { key: 'grouping', label: 'Grupiranje', completed: true, active: false },
  { key: 'downloading', label: 'Preuzimanje', completed: true, active: false },
  { key: 'extracting', label: 'Obrada dokumenata', completed: false, active: true },
  { key: 'chunking', label: 'Segmentiranje', completed: false, active: false },
  { key: 'retrieving', label: 'Dohvat dokaza', completed: false, active: false },
  { key: 'reasoning', label: 'AI analiza', completed: false, active: false },
  { key: 'verifying', label: 'Provjera', completed: false, active: false },
  { key: 'complete', label: 'Završeno', completed: false, active: false },
];

const SAMPLE_SOURCE_DOCS = [
  { id: 'doc-1', fileName: 'Tablica_ispitanih_trazbina.pdf' },
  { id: 'doc-2', fileName: 'Ugovor_o_ustupu_trazbine.pdf' },
  { id: 'doc-3', fileName: 'Rjesenje_o_namirenju.pdf' },
];

const SAMPLE_VALUE_CHANGES = [
  {
    description: 'B2 KAPITAL d.o.o. · Tražbina 1. višeg isplatnog reda (r. br. 14)',
    linkage: 'claimRegistryNumber',
    comparisonStatus: 'comparable',
    originalValue: 185000,
    latestValue: 112500,
    delta: -72500,
    discountPct: -39.2,
    currency: 'EUR',
    stages: [
      {
        id: 'st-1',
        date: '2023-03-14',
        eventType: 'prijava',
        transferor: 'Privredna banka Zagreb d.d.',
        amountEur: 185000,
        valueRole: 'claim_balance',
        docId: 'doc-1',
        fileName: 'Tablica_ispitanih_trazbina.pdf',
        sourcePages: '4',
        sourceChunkId: 'c-12',
      },
      {
        id: 'st-2',
        date: '2023-09-22',
        eventType: 'ustup',
        transferor: 'Privredna banka Zagreb d.d.',
        transferee: 'B2 KAPITAL d.o.o.',
        amountEur: 72500,
        valueRole: 'payment_amount',
        docId: 'doc-2',
        fileName: 'Ugovor_o_ustupu_trazbine.pdf',
        sourcePages: '2',
        sourceChunkId: 'c-04',
      },
      {
        id: 'st-3',
        date: '2024-02-08',
        eventType: 'namirenje',
        transferor: 'B2 KAPITAL d.o.o.',
        amountEur: 112500,
        valueRole: 'claim_balance',
        docId: 'doc-3',
        fileName: 'Rjesenje_o_namirenju.pdf',
        sourcePages: '7–8',
        sourceChunkId: 'c-19',
      },
    ],
  },
];

function readComputedTokens() {
  if (typeof window === 'undefined' || !document?.documentElement) return {};
  const styles = window.getComputedStyle(document.documentElement);
  const vars = [
    ...SURFACE_TOKENS.map((t) => t.name),
    ...STATUS_TOKENS.flatMap((s) => [s.fgVar, s.bgVar]),
  ];
  const resolved = {};
  for (const name of vars) {
    const value = styles.getPropertyValue(name)?.trim();
    if (value) resolved[name] = value;
  }
  return resolved;
}

export default function DesignSystemPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sampleInput, setSampleInput] = useState('St-2/2013');
  const [liveTokens, setLiveTokens] = useState({});
  const [copiedKey, setCopiedKey] = useState(null);
  const copyTimerRef = useRef(null);

  useEffect(() => {
    setLiveTokens(readComputedTokens());
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopyToken = async (key, text) => {
    try {
      await navigator?.clipboard?.writeText?.(text);
    } catch {
      // Clipboard API may be unavailable in restricted contexts; still confirm selection state
    }
    setCopiedKey(key);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedKey(null), 1600);
  };

  return (
    <DashboardShell>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <header className="border-b border-line pb-5">
          <div className="text-sm text-ink-muted">
            <Link to="/dashboard" className="hover:underline">Dashboard</Link> / dizajn sustav
          </div>
          <div className="mt-1.5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-ink">
                Dizajn sustav i komponente
              </h1>
              <p className="mt-1 text-sm text-ink-muted">
                Jedinstveni izvor istine za tokene (<code className="font-mono text-ink">src/styles/tokens.css</code>),
                WCAG AA kontraste i UI primitive (<code className="font-mono text-ink">src/components/ui/</code>).
              </p>
            </div>
            <Badge tone="info">Tailwind v4 · Radix · CVA</Badge>
          </div>
        </header>

        {/* 1. Tokens: Surfaces, Borders, Accent & Status */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="eyebrow">01 · Semantički tokeni</p>
                <CardTitle className="mt-1">Površine, obrubi i statusne nijanse</CardTitle>
              </div>
              <span className="text-xs text-ink-muted" aria-live="polite">
                {copiedKey ? `Kopirano: ${copiedKey}` : 'Kliknite token za kopiranje naziva'}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {SURFACE_TOKENS.map((token) => {
                const computedHex = liveTokens[token.name] || token.hex;
                const isCopied = copiedKey === token.utility;
                return (
                  <button
                    key={token.name}
                    type="button"
                    onClick={() => handleCopyToken(token.utility, token.utility)}
                    aria-label={`Kopiraj ${token.utility}`}
                    className="rounded-md border border-line bg-surface p-3 text-left transition-colors hover:border-line-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-9 w-9 shrink-0 rounded-md ${token.previewClass}`} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate font-mono text-xs font-medium text-ink">{token.utility}</p>
                          {isCopied ? (
                            <span className="text-xs font-medium text-success">Kopirano</span>
                          ) : null}
                        </div>
                        <p className="font-mono text-xs text-ink-muted">{computedHex}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-ink-muted">{token.note}</p>
                  </button>
                );
              })}
            </div>

            <div>
              <h3 className="mb-2.5 text-sm font-medium text-ink">
                Statusni parovi (uvijek uz glif i tekstualnu oznaku)
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {STATUS_TOKENS.map((st) => {
                  const fgLive = liveTokens[st.fgVar] || st.fgHex;
                  const bgLive = liveTokens[st.bgVar] || st.bgHex;
                  const pairUtility = `${st.fg} / ${st.bg}`;
                  const isCopied = copiedKey === pairUtility;
                  return (
                    <button
                      key={st.name}
                      type="button"
                      onClick={() => handleCopyToken(pairUtility, pairUtility)}
                      aria-label={`Kopiraj ${pairUtility}`}
                      className={`rounded-md border border-line p-3 text-left transition-colors hover:border-line-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${st.bg}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-sm font-semibold ${st.fg}`}>{st.name} · {st.label}</p>
                        {isCopied ? <span className="text-xs font-medium text-success">Kopirano</span> : null}
                      </div>
                      <p className="mt-1 font-mono text-xs text-ink-muted">{pairUtility}</p>
                      <p className="font-mono text-xs text-ink-muted">{fgLive} / {bgLive}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 2. Typography & Geometry */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <p className="eyebrow">02 · Tipografija</p>
              <CardTitle className="mt-1">Skala teksta i pravni brojevi</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="eyebrow">Eyebrow oznaka (11px uppercase)</div>
              <div className="text-2xl font-semibold tracking-tight text-ink">Naslov stranice (27px)</div>
              <div className="text-xl font-semibold text-ink">Naslov sekcije (21px)</div>
              <div className="text-base text-ink">Osnovni pravni tekst (15px, line-height 1.6)</div>
              <div className="text-sm text-ink-muted">Sekundarne informacije i citati (13px)</div>
              <div className="flex flex-wrap gap-3 border-t border-line pt-3 text-sm">
                <span className="font-mono tabular-nums text-ink">OIB: 66124057408</span>
                <span className="font-mono tabular-nums text-ink">St-2/2013-1155</span>
                <span className="font-mono font-semibold tabular-nums text-ink">1.200.000,00 EUR</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <p className="eyebrow">03 · Geometrija</p>
              <CardTitle className="mt-1">Centralizirani radijusi (--radius: 10px)</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-line bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-block rounded-sm border border-line-control bg-surface-muted px-2 py-0.5 font-mono text-xs text-ink">
                    4px
                  </span>
                  <span className="font-mono text-xs text-ink-muted">rounded-sm</span>
                </div>
                <p className="mt-2 text-xs text-ink-muted">Oznake, istaknuti citati, skeletoni</p>
              </div>

              <div className="rounded-md border border-line bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-block rounded-md border border-line-control bg-surface-muted px-2.5 py-0.5 font-mono text-xs text-ink">
                    6px
                  </span>
                  <span className="font-mono text-xs text-ink-muted">rounded-md</span>
                </div>
                <p className="mt-2 text-xs text-ink-muted">Gumbi, polja unosa, callouti</p>
              </div>

              <div className="rounded-md border border-line bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-block rounded-lg border border-line-control bg-surface-muted px-2.5 py-1 font-mono text-xs text-ink">
                    10px
                  </span>
                  <span className="font-mono text-xs text-ink-muted">rounded-lg</span>
                </div>
                <p className="mt-2 text-xs text-ink-muted">Kartice (.card), dijalozi, ladice</p>
              </div>

              <div className="rounded-md border border-line bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-block rounded-full border border-line-control bg-surface-muted px-3 py-0.5 font-mono text-xs text-ink">
                    pill
                  </span>
                  <span className="font-mono text-xs text-ink-muted">rounded-full</span>
                </div>
                <p className="mt-2 text-xs text-ink-muted">Samo statusne i referentne pilule</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 3. Interactive Primitives */}
        <Card>
          <CardHeader>
            <p className="eyebrow">04 · Interaktivni primitivni elementi</p>
            <CardTitle className="mt-1">Gumbi, unosi, statusi i obavijesti</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h3 className="mb-2 text-sm font-medium text-ink">Button varijante</h3>
              <div className="flex flex-wrap items-center gap-2.5">
                <Button variant="primary">Primarna akcija</Button>
                <Button variant="secondary">Sekundarna akcija</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger">Otkaži / Opasna akcija</Button>
                <Button variant="secondary" size="sm">Mala (sm)</Button>
                <Button variant="primary" disabled>Onemogućeno</Button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="ds-input-normal" className="mb-1 block text-xs font-medium text-ink-muted">
                  Standardni unos (3:1 obrub)
                </label>
                <Input
                  id="ds-input-normal"
                  value={sampleInput}
                  onChange={(e) => setSampleInput(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="ds-input-invalid" className="mb-1 block text-xs font-medium text-ink-muted">
                  Neispravan unos (aria-invalid)
                </label>
                <Input id="ds-input-invalid" defaultValue="Neispravan OIB" aria-invalid="true" />
              </div>
              <div>
                <label htmlFor="ds-input-disabled" className="mb-1 block text-xs font-medium text-ink-muted">
                  Onemogućeno polje
                </label>
                <Input id="ds-input-disabled" defaultValue="Zaključano" disabled />
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-medium text-ink">StatusBadge vokabular i referentne oznake</h3>
              <div className="flex flex-wrap items-center gap-2">
                {RUN_STATUSES.map((status) => (
                  <StatusBadge key={status} status={status} />
                ))}
                <span className="pill">str. 4–5</span>
                <span className="pill-warn">⚠ nepotvrđeno</span>
                <mark className="rounded-sm bg-warning-surface px-1 py-0.5 text-sm font-medium text-ink underline decoration-warning decoration-2 underline-offset-2">
                  120.000,00 EUR
                </mark>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Callout
                tone="info"
                title="Informativna obavijest"
                className="mb-0"
                action={
                  <Button variant="secondary" size="sm" onClick={() => setSheetOpen(true)}>
                    Otvori dokaz
                  </Button>
                }
              >
                Neutralan kontekst ili pronađene nove objave.
              </Callout>
              <Callout tone="success" title="Potvrđeno stanje" className="mb-0">
                Svi podaci odgovaraju zadnjoj provjeri.
              </Callout>
              <Callout tone="warning" title="Djelomični / fallback izvještaj" className="mb-0">
                Prikazuje se deterministički sažetak ($0) bez AI troška.
              </Callout>
              <Callout tone="danger" title="Greška obrade" className="mb-0">
                Obrada nije uspjela; prethodni podaci su sačuvani.
              </Callout>
            </div>
          </CardContent>
        </Card>

        {/* 4. Legal-Data & Loading Primitives */}
        <Card>
          <CardHeader>
            <p className="eyebrow">05 · Pravni podaci</p>
            <CardTitle className="mt-1">Pokrivenost, iznosi, skeletoni i tijek tražbine</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-md border border-line bg-surface p-3">
                <p className="mb-2 text-xs font-medium text-ink-muted">CoverageCell (pokrivenost vs. neuspjeh)</p>
                <div className="flex flex-wrap items-start gap-6">
                  <CoverageCell
                    coverage={{
                      analyzed: 163,
                      total: 163,
                      coverageRatio: 1,
                      groundedClaims: 5566,
                      totalClaims: 5705,
                    }}
                    status="done"
                  />
                  <CoverageCell coverage={null} status="error" />
                </div>
              </div>

              <div className="rounded-md border border-line bg-surface p-3">
                <p className="mb-2 text-xs font-medium text-ink-muted">AmountCell (jednosmjerni zbroj vs. —)</p>
                <div className="flex items-center gap-6">
                  <AmountCell amounts={{ singleDirection: true, eurTotal: 1245000.5 }} />
                  <AmountCell amounts={{ singleDirection: false }} />
                </div>
              </div>

              <div className="rounded-md border border-line bg-surface p-3">
                <p className="mb-2 text-xs font-medium text-ink-muted">Skeleton učitavanje (.skeleton)</p>
                <div className="space-y-2" aria-label="Primjer skeleton učitavanja">
                  <div className="grid grid-cols-[2fr_1fr] gap-2" aria-hidden="true">
                    <div className="skeleton h-4 w-full" />
                    <div className="skeleton h-4 w-full" />
                  </div>
                  <div className="skeleton h-3.5 w-4/5" aria-hidden="true" />
                </div>
              </div>
            </div>

            <details className="rounded-md border border-line bg-surface px-4 py-3">
              <summary className="cursor-pointer text-sm font-medium text-ink">
                Primjer tijeka tražbine (LifecycleTimeline)
              </summary>
              <div className="mt-2">
                <LifecycleTimeline
                  embedded
                  valueChanges={SAMPLE_VALUE_CHANGES}
                  sourceDocuments={SAMPLE_SOURCE_DOCS}
                />
              </div>
            </details>
          </CardContent>
        </Card>

        {/* 5. Tabs, Overlays & PipelinePhases */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <Card>
            <CardHeader>
              <p className="eyebrow">06 · Navigacija i slojevi</p>
              <CardTitle className="mt-1">Tabs, Dialog i Sheet preglednik</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <Tabs defaultValue="tab-1">
                <TabsList aria-label="Primjer kartica">
                  <TabsTrigger value="tab-1">Pregled</TabsTrigger>
                  <TabsTrigger value="tab-2">
                    <span className="inline-flex items-center gap-1.5">
                      Dokazi
                      <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-xs tabular-nums text-ink-muted">
                        3
                      </span>
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="tab-3">Kronologija</TabsTrigger>
                  <TabsTrigger value="tab-4" disabled>Zaključano</TabsTrigger>
                </TabsList>
                <TabsContent value="tab-1">
                  <p className="text-sm text-ink-muted">
                    Kartice podržavaju tipkovničku navigaciju (<code className="font-mono text-ink">←</code>,{' '}
                    <code className="font-mono text-ink">→</code>, <code className="font-mono text-ink">Home</code>,{' '}
                    <code className="font-mono text-ink">End</code>).
                  </p>
                </TabsContent>
                <TabsContent value="tab-2">
                  <p className="text-sm text-ink-muted">Primjer sadržaja druge kartice s brojačem zapisa.</p>
                </TabsContent>
                <TabsContent value="tab-3">
                  <p className="text-sm text-ink-muted">Primjer sadržaja treće kartice za kronologiju predmeta.</p>
                </TabsContent>
              </Tabs>

              <div className="flex flex-wrap gap-3 border-t border-line pt-4">
                <Button variant="secondary" onClick={() => setDialogOpen(true)}>
                  Otvori Dialog modal
                </Button>
                <Button variant="primary" onClick={() => setSheetOpen(true)}>
                  Otvori Sheet ladicu dokaza
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            <p className="eyebrow">07 · Faze obrade</p>
            <PipelinePhases
              stages={SAMPLE_STAGES}
              runStatus="running"
              coverage={{ analyzed: 94, total: 100, failed: 1 }}
              scope={{ corpus: { capturedEntries: 100 } }}
              retrieval={{ metrics: { matchCount: 24 } }}
            />
          </div>
        </div>

        <Dialog
          isOpen={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="Primjer Dialog komponente"
          description="Radix modal s zaključavanjem fokusa i Escape zatvaranjem."
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-ink-muted">
              Koristi se za potvrde otkazivanja, novu analizu i pregled LLM tragova.
            </p>
            <div className="flex justify-end">
              <Button variant="primary" size="sm" onClick={() => setDialogOpen(false)}>
                Zatvori
              </Button>
            </div>
          </div>
        </Dialog>

        <Sheet
          isOpen={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="Primjer Sheet ladice"
          description="Bočni preglednik za izvorni kontekst citata i dokaza."
          size="md"
        >
          <div className="space-y-3">
            <span className="pill">str. 4–5</span>
            <p className="rounded-md border border-line bg-surface-muted p-4 text-sm leading-relaxed text-ink">
              Stečajni vjerovnik prijavljuje tražbinu prvog višeg isplatnog reda u iznosu od{' '}
              <mark className="rounded-sm bg-warning-surface px-0.5 font-medium text-ink underline decoration-warning decoration-2 underline-offset-2">
                120.000,00 EUR
              </mark>{' '}
              na temelju pravomoćne presude.
            </p>
          </div>
        </Sheet>
      </main>
    </DashboardShell>
  );
}
