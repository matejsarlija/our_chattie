import React, { useMemo } from 'react';
import RunStatusBadge from '../../components/Dashboard/RunStatusBadge';
import RunProgressStepper from '../../components/Dashboard/RunProgressStepper';
import RunEventTimeline from '../../components/Dashboard/RunEventTimeline';
import { useAnalysisEvents } from '../../hooks/useAnalysisEvents';
import { CaseEntryMetadataSection, SAMPLE_CASE_ENTRIES } from './AnalysisDetail/CaseEntryMetadataModules';

const STATUS_BY_TERMINAL = {
  running: 'running',
  completed: 'completed',
  failed: 'failed',
};

const withStoryDoc = (summary) => ({
  docs: {
    description: {
      story: summary,
    },
  },
});

const CONNECTION_LABELS = {
  live: 'Live',
  polling: 'Syncing',
  idle: 'Idle',
};

const formatDate = (iso) => {
  if (!iso) return '-';
  return new Intl.DateTimeFormat('hr-HR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
};

const baseEvents = [
  {
    id: 'ev-1',
    event_type: 'queued',
    message: 'Zahtjev je zaprimljen.',
    created_at: '2026-02-19T10:00:01.000Z',
    metadata: { progress: 1 },
  },
  {
    id: 'ev-2',
    event_type: 'starting',
    message: 'Priprema obrade predmeta.',
    created_at: '2026-02-19T10:00:05.000Z',
    metadata: { progress: 5 },
  },
  {
    id: 'ev-3',
    event_type: 'fetching',
    message: 'Preuzimanje sudskih zapisa.',
    created_at: '2026-02-19T10:00:12.000Z',
    metadata: { progress: 18 },
  },
  {
    id: 'ev-4',
    event_type: 'extracting',
    message: 'Ekstrakcija teksta iz dokumenata.',
    created_at: '2026-02-19T10:00:31.000Z',
    metadata: { progress: 44 },
  },
  {
    id: 'ev-5',
    event_type: 'analyzing',
    message: 'Analiza sadržaja i klasifikacija nalaza.',
    created_at: '2026-02-19T10:00:50.000Z',
    metadata: { progress: 72 },
  },
];

const buildEvents = ({ eventsDensity, terminalStatus }) => {
  const dense = [...baseEvents];
  const sparse = [baseEvents[0], baseEvents[baseEvents.length - 1]];
  const active = eventsDensity === 'sparse' ? sparse : dense;

  if (terminalStatus === 'completed') {
    return [
      ...active,
      {
        id: 'ev-complete',
        event_type: 'complete',
        message: 'Analiza je završena.',
        created_at: '2026-02-19T10:01:20.000Z',
        metadata: { progress: 100 },
      },
    ];
  }

  if (terminalStatus === 'failed') {
    return [
      ...active,
      {
        id: 'ev-error',
        event_type: 'error',
        message: 'Došlo je do greške pri obradi jednog dokumenta.',
        created_at: '2026-02-19T10:01:06.000Z',
        metadata: { progress: 78 },
      },
    ];
  }

  return active;
};

const buildRun = ({ terminalStatus, events }) => {
  const status = STATUS_BY_TERMINAL[terminalStatus] || 'running';
  const latest = events[events.length - 1]?.created_at || '2026-02-19T10:00:50.000Z';

  return {
    id: 'analysis-run-story',
    oib: '12345678901',
    status,
    created_at: '2026-02-19T10:00:00.000Z',
    updated_at: latest,
    completed_at: terminalStatus === 'completed' ? latest : null,
    result_text: terminalStatus === 'completed'
      ? '## Sažetak nalaza\n\n- Utvrđeni su obrasci koji upućuju na konzistentnu praksu.\n- Predmeti su vremenski i činjenično usporedivi.\n- Predlaže se fokus na novije presude pri izradi argumentacije.'
      : '',
  };
};

function MilestoneDotsPanel({ stages }) {
  const milestones = stages.filter((_, idx) => idx === 0 || idx === 2 || idx === 4 || idx === stages.length - 1);

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="mb-3 text-sm font-semibold text-[var(--text)]">Milestones</h3>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {milestones.map((stage) => (
          <li key={stage.key} className="rounded-lg border border-[var(--border)] p-2">
            <div className="mb-1 flex items-center gap-2">
              <span
                className={`inline-flex h-2.5 w-2.5 rounded-full ${
                  stage.completed ? 'bg-[var(--success)]' : stage.active ? 'bg-[var(--accent)]' : 'bg-slate-300'
                }`}
              />
              <span className="text-xs font-medium text-[var(--text)]">{stage.label}</span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">{stage.active ? 'Trenutno aktivno' : stage.completed ? 'Dovršeno' : 'Čeka'}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SubtleRailStepperPrototype({ stages, isErrored, subtleRailStyle = 'default' }) {
  const renderConnectedBridge = () => (
    <ol className="flex items-center gap-0 overflow-x-auto pb-1">
      {stages.map((stage, index) => {
        const isLast = index === stages.length - 1;
        const lineTone = stage.completed
          ? 'bg-emerald-400'
          : stage.active
            ? 'bg-sky-400'
            : 'bg-slate-200';
        const dotTone = stage.completed
          ? 'bg-emerald-500 ring-2 ring-emerald-200'
          : stage.active
            ? 'bg-sky-500 ring-2 ring-sky-200'
            : 'bg-slate-300 ring-2 ring-slate-200';
        const cardTone = stage.active
          ? 'border-sky-200 bg-sky-50/50'
          : stage.completed
            ? 'border-emerald-200 bg-emerald-50/40'
            : 'border-[var(--border)] bg-[var(--surface)]';

        return (
          <li key={stage.key} className="flex shrink-0 items-center">
            <div className={`flex min-h-[42px] min-w-[176px] items-center gap-2 rounded-xl border px-3 py-2 transition-colors ${cardTone}`}>
              <span className={`inline-flex h-2.5 w-2.5 rounded-full ${dotTone}`} />
              <span className={`text-xs ${stage.active ? 'font-medium text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
                {stage.label}
              </span>
            </div>
            {!isLast && (
              <span aria-hidden="true" className="mx-1 inline-flex shrink-0 items-center">
                <span className={`h-[2px] w-5 rounded-full ${lineTone}`} />
                <span className={`mx-1 h-2 w-2 rounded-full ${lineTone}`} />
                <span className={`h-[2px] w-5 rounded-full ${lineTone}`} />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );

  const renderTrackLine = () => (
    <div className="relative">
      <span className="absolute left-0 right-0 top-[21px] h-px bg-slate-200" />
      <ol className="relative flex items-center gap-2 overflow-x-auto pb-1">
        {stages.map((stage) => {
          const dotTone = stage.completed
            ? 'bg-teal-500 ring-2 ring-teal-200'
            : stage.active
              ? 'bg-cyan-500 ring-2 ring-cyan-200'
              : 'bg-slate-300 ring-2 ring-slate-200';
          const cardTone = stage.active
            ? 'border-cyan-200 bg-cyan-50/45'
            : stage.completed
              ? 'border-teal-200 bg-teal-50/40'
              : 'border-[var(--border)] bg-[var(--surface)]';

          return (
            <li key={stage.key} className="shrink-0">
              <div className={`flex min-h-[42px] min-w-[178px] items-center gap-2 rounded-xl border px-3 py-2 transition-colors ${cardTone}`}>
                <span className={`inline-flex h-2.5 w-2.5 rounded-full ${dotTone}`} />
                <span className={`text-xs ${stage.active ? 'font-medium text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
                  {stage.label}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );

  const renderArrowFlow = () => (
    <ol className="flex items-center gap-0 overflow-x-auto pb-1">
      {stages.map((stage, index) => {
        const isLast = index === stages.length - 1;
        const arrowTone = stage.completed
          ? 'text-lime-400'
          : stage.active
            ? 'text-blue-400'
            : 'text-slate-300';
        const dotTone = stage.completed
          ? 'bg-lime-500 ring-2 ring-lime-200'
          : stage.active
            ? 'bg-blue-500 ring-2 ring-blue-200'
            : 'bg-slate-300 ring-2 ring-slate-200';
        const cardTone = stage.active
          ? 'border-blue-200 bg-blue-50/45'
          : stage.completed
            ? 'border-lime-200 bg-lime-50/40'
            : 'border-[var(--border)] bg-[var(--surface)]';

        return (
          <li key={stage.key} className="flex shrink-0 items-center">
            <div className={`flex min-h-[42px] min-w-[174px] items-center gap-2 rounded-xl border px-3 py-2 transition-colors ${cardTone}`}>
              <span className={`inline-flex h-2.5 w-2.5 rounded-full ${dotTone}`} />
              <span className={`text-xs ${stage.active ? 'font-medium text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
                {stage.label}
              </span>
            </div>
            {!isLast && (
              <span aria-hidden="true" className={`mx-2 inline-flex shrink-0 text-sm leading-none ${arrowTone}`}>
                &rsaquo;
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text)]">Napredak obrade</h3>
        {isErrored && <span className="text-xs font-medium text-[var(--danger)]">Detektirana greška</span>}
      </div>
      {subtleRailStyle === 'connected-bridge'
        ? renderConnectedBridge()
        : subtleRailStyle === 'track-line'
          ? renderTrackLine()
          : subtleRailStyle === 'arrow-flow'
            ? renderArrowFlow()
            : null}
    </div>
  );
}

function ProgressPresentationStory({
  variantMode = 'subtle-rail',
  subtleRailStyle = 'default',
  connectionMode = 'live',
  eventsDensity = 'rich',
  terminalStatus = 'running',
  expanded = false,
  escalateError = false,
  showMetadataModules = false,
  metadataCompact = false,
  showStructuredAnnex = false,
}) {
  const events = useMemo(
    () => buildEvents({ eventsDensity, terminalStatus }),
    [eventsDensity, terminalStatus]
  );
  const run = useMemo(() => buildRun({ terminalStatus, events }), [terminalStatus, events]);
  const { timeline, stages, current, isErrored } = useAnalysisEvents(events);
  const isRunning = terminalStatus === 'running';
  const latestEvent = timeline[timeline.length - 1];
  const shouldEscalateError = escalateError && isErrored;
  const isContextStrip = variantMode === 'context-strip';
  const isRightRail = variantMode === 'right-rail';
  const isMilestoneDots = variantMode === 'milestone-dots';
  const isChronicleFirst = variantMode === 'chronicle-first';
  const isTerminalCompression = variantMode === 'terminal-compression';

  const mutedContainerClass = variantMode === 'subtle-rail'
    ? 'space-y-3'
    : variantMode === 'quiet-full'
      ? 'space-y-4'
      : 'space-y-2';

  const timelineToRender = expanded || variantMode === 'quiet-full'
    ? timeline
    : timeline.slice(-2);

  const compressedTerminal = isTerminalCompression && !isRunning && !expanded;

  const progressBlock = (
    <section className={mutedContainerClass}>
      {shouldEscalateError && (
        <div className="rounded-xl border border-[var(--danger)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--danger)]">
          Obrada je prekinuta. Prikazani su ključni događaji za dijagnostiku.
        </div>
      )}

      {isContextStrip && latestEvent && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <p className="text-sm text-[var(--text)]">
            {latestEvent.stageLabel}: <span className="text-[var(--text-muted)]">{latestEvent.message}</span>
          </p>
        </div>
      )}

      {variantMode !== 'signal-line' && !isContextStrip && !isMilestoneDots && !isChronicleFirst && !compressedTerminal && (
        <div className={variantMode === 'subtle-rail' ? 'opacity-85' : ''}>
          {variantMode === 'subtle-rail' && subtleRailStyle !== 'default' ? (
            <SubtleRailStepperPrototype
              stages={stages}
              isErrored={isErrored}
              subtleRailStyle={subtleRailStyle}
            />
          ) : (
            <RunProgressStepper stages={stages} isErrored={isErrored} currentStage={current} />
          )}
        </div>
      )}

      {isMilestoneDots && <MilestoneDotsPanel stages={stages} />}

      {isChronicleFirst && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text)]">Chronicle</h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Kronologija događaja je primarni signal, stepper je sekundaran.</p>
        </div>
      )}

      {compressedTerminal ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm text-[var(--text)]">Obrada je zaključena.</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Status i rezultat su primarni; detaljni log je skriven dok ga korisnik ne otvori.</p>
        </div>
      ) : (variantMode === 'quiet-full' || expanded || shouldEscalateError || timeline.length <= 2 || isChronicleFirst) ? (
        <RunEventTimeline timeline={isChronicleFirst ? timeline : timelineToRender} isRunning={isRunning} loading={false} />
      ) : (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text)]">Zadnji događaji</h3>
          <div className="mt-3">
            <RunEventTimeline timeline={timelineToRender} isRunning={isRunning} loading={false} />
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            U ovoj varijanti detaljna kronologija je sekundarna i otvara se na zahtjev.
          </p>
        </div>
      )}

      {isChronicleFirst && (
        <div className="opacity-85">
          <RunProgressStepper stages={stages} isErrored={isErrored} currentStage={current} />
        </div>
      )}
    </section>
  );

  const resultBlock = (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-sm font-semibold text-[var(--text)]">Rezultat analize (kontekst)</h2>
      {run.result_text ? (
        <article className="mt-2 whitespace-pre-wrap text-sm leading-7 text-[var(--text)]">{run.result_text}</article>
      ) : (
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Rezultat još nije dostupan; fokus je na praćenju statusa i događaja obrade.
        </p>
      )}
      {showStructuredAnnex && (
        <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text)]">Prilozi analize (strukturirano)</h3>
          <div className="mt-3 space-y-3 text-sm">
            <div>
              <p className="font-medium text-[var(--text)]">Nalazi</p>
              <p className="text-[var(--text-muted)]">Utvrđen je kontinuitet postupanja u usporedivim predmetima.</p>
            </div>
            <div>
              <p className="font-medium text-[var(--text)]">Vremenska crta</p>
              <p className="text-[var(--text-muted)]">Otvoren postupak, zatim prijava tražbina i završna raspodjela.</p>
            </div>
            <div>
              <p className="font-medium text-[var(--text)]">Konflikti</p>
              <p className="text-[var(--text-muted)]">Nema prijavljenih konflikata.</p>
            </div>
            <div>
              <p className="font-medium text-[var(--text)]">Otvorena pitanja</p>
              <p className="text-[var(--text-muted)]">Nedostaje potvrda datuma dospijeća glavnog potraživanja.</p>
            </div>
          </div>
        </section>
      )}
    </section>
  );

  return (
    <main className="min-h-screen bg-[var(--bg)] px-4 py-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <RunStatusBadge status={run.status} />
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1 text-xs text-[var(--text-muted)]">
                {CONNECTION_LABELS[connectionMode] || CONNECTION_LABELS.idle}
              </span>
              <span className="text-sm text-[var(--text-muted)]">OIB: {run.oib}</span>
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              Ažurirano: {formatDate(run.updated_at)}
            </div>
          </div>
          {variantMode === 'signal-line' && latestEvent && (
            <p className="mt-2 text-sm text-[var(--text)]">
              Trenutni korak: <strong>{latestEvent.stageLabel}</strong> - {latestEvent.message}
            </p>
          )}
        </section>

        {showMetadataModules && (
          <CaseEntryMetadataSection entries={SAMPLE_CASE_ENTRIES} compact={metadataCompact} />
        )}

        {isRightRail ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            {resultBlock}
            <aside className="lg:sticky lg:top-4">{progressBlock}</aside>
          </div>
        ) : (
          <>
            {progressBlock}
            {resultBlock}
          </>
        )}
      </div>
    </main>
  );
}

const meta = {
  title: 'Dashboard/AnalysisDetail/ProgressPresentation',
  component: ProgressPresentationStory,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: [
          'Exploration stories for deaccentuated but informative progress UX on analysis detail page.',
          '',
          'How to evaluate quickly:',
          '1. Run `RunningRichEvents` and `RunningSparseEvents` for glanceability while active.',
          '2. Run `CompletedWithResult` for whether result readability wins after terminal state.',
          '3. Run `ErrorEscalation` for whether failures feel obvious without being noisy.',
          '4. Use `DashboardRichMetadata` for approved baseline with structured-annex context.',
          '5. Governance sync: 2026-03-08.',
          '6. Governance reference: D-08-full-governance-pass.',
          '',
          'Feedback format:',
          '- Pick one variant baseline',
          '- Note what to keep',
          '- Note what to soften',
          '- Note what should become expandable/secondary',
        ].join('\\n'),
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    variantMode: {
      control: 'select',
      options: [
        'subtle-rail',
        'quiet-full',
        'signal-line',
        'context-strip',
        'right-rail',
        'milestone-dots',
        'chronicle-first',
        'terminal-compression',
      ],
    },
    subtleRailStyle: {
      control: 'select',
      options: ['default', 'connected-bridge', 'track-line', 'arrow-flow'],
      if: { arg: 'variantMode', eq: 'subtle-rail' },
    },
    connectionMode: {
      control: 'inline-radio',
      options: ['live', 'polling', 'idle'],
    },
    eventsDensity: {
      control: 'inline-radio',
      options: ['rich', 'sparse'],
    },
    terminalStatus: {
      control: 'inline-radio',
      options: ['running', 'completed', 'failed'],
    },
    expanded: {
      control: 'boolean',
    },
    escalateError: {
      control: 'boolean',
    },
    showMetadataModules: {
      control: 'boolean',
    },
    metadataCompact: {
      control: 'boolean',
      if: { arg: 'showMetadataModules', eq: true },
    },
    showStructuredAnnex: {
      control: 'boolean',
    },
  },
};

export default meta;

export const Playground = {
  args: {
    variantMode: 'subtle-rail',
    subtleRailStyle: 'default',
    connectionMode: 'live',
    eventsDensity: 'rich',
    terminalStatus: 'running',
    expanded: false,
    escalateError: false,
    showMetadataModules: false,
    metadataCompact: false,
    showStructuredAnnex: false,
  },
  parameters: withStoryDoc(
    'Use this to compare variants with controls. Start from subtle-rail and switch `variantMode` + `terminalStatus`.'
  ),
};

export const SubtleRailDefault = {
  args: {
    variantMode: 'subtle-rail',
    connectionMode: 'live',
    eventsDensity: 'rich',
    terminalStatus: 'running',
    expanded: false,
    escalateError: false,
    showMetadataModules: false,
    metadataCompact: false,
    showStructuredAnnex: false,
  },
  parameters: withStoryDoc(
    'Balanced default. Progress is informative but visually secondary. Good baseline when result text should stay primary.'
  ),
};

export const QuietFullStack = {
  args: {
    variantMode: 'quiet-full',
    connectionMode: 'polling',
    eventsDensity: 'rich',
    terminalStatus: 'running',
    expanded: true,
    escalateError: false,
    showMetadataModules: false,
    metadataCompact: false,
    showStructuredAnnex: false,
  },
  parameters: withStoryDoc(
    'Full progress always visible, but quiet. Choose this if operations team needs full timeline without extra clicks.'
  ),
};

export const SignalLine = {
  args: {
    variantMode: 'signal-line',
    connectionMode: 'live',
    eventsDensity: 'sparse',
    terminalStatus: 'running',
    expanded: false,
    escalateError: false,
    showMetadataModules: false,
    metadataCompact: false,
    showStructuredAnnex: false,
  },
  parameters: withStoryDoc(
    'Most compact active mode. Single-line status first, details hidden. Best for minimal visual interruption.'
  ),
};

export const ContextStrip = {
  args: {
    variantMode: 'context-strip',
    connectionMode: 'live',
    eventsDensity: 'rich',
    terminalStatus: 'running',
    expanded: false,
    escalateError: false,
    showMetadataModules: false,
    metadataCompact: false,
    showStructuredAnnex: false,
  },
  parameters: withStoryDoc(
    'A lightweight contextual strip under metadata. Keeps orientation high while deaccentuating heavy progress chrome.'
  ),
};

export const RightRailMonitor = {
  args: {
    variantMode: 'right-rail',
    connectionMode: 'polling',
    eventsDensity: 'rich',
    terminalStatus: 'running',
    expanded: false,
    escalateError: false,
    showMetadataModules: false,
    metadataCompact: false,
    showStructuredAnnex: false,
  },
  parameters: withStoryDoc(
    'Desktop monitor-style layout: result left, progress right. Strong for long legal markdown reading sessions.'
  ),
};

export const MilestoneDots = {
  args: {
    variantMode: 'milestone-dots',
    connectionMode: 'live',
    eventsDensity: 'sparse',
    terminalStatus: 'running',
    expanded: false,
    escalateError: false,
    showMetadataModules: false,
    metadataCompact: false,
    showStructuredAnnex: false,
  },
  parameters: withStoryDoc(
    'Abstracted pipeline view. Fewer cues than timeline, cleaner glanceability, less detail density.'
  ),
};

export const ChronicleFirst = {
  args: {
    variantMode: 'chronicle-first',
    connectionMode: 'polling',
    eventsDensity: 'rich',
    terminalStatus: 'running',
    expanded: true,
    escalateError: false,
    showMetadataModules: false,
    metadataCompact: false,
    showStructuredAnnex: false,
  },
  parameters: withStoryDoc(
    'Event feed is the primary signal; stepper becomes secondary. Prefer when event text has high explanatory value.'
  ),
};

export const TerminalCompression = {
  args: {
    variantMode: 'terminal-compression',
    connectionMode: 'idle',
    eventsDensity: 'rich',
    terminalStatus: 'completed',
    expanded: false,
    escalateError: false,
    showMetadataModules: false,
    metadataCompact: false,
    showStructuredAnnex: false,
  },
  parameters: withStoryDoc(
    'Auto-compress progress after completion/failure so result becomes dominant. Best if terminal sessions are mostly read-only.'
  ),
};

export const ErrorEscalation = {
  args: {
    variantMode: 'subtle-rail',
    connectionMode: 'polling',
    eventsDensity: 'rich',
    terminalStatus: 'failed',
    expanded: true,
    escalateError: true,
    showMetadataModules: false,
    metadataCompact: false,
    showStructuredAnnex: false,
  },
  parameters: withStoryDoc(
    'Quiet baseline that escalates only on error. Use this to validate that failures become obvious without constant visual noise.'
  ),
};

export const RunningRichEvents = {
  args: {
    variantMode: 'subtle-rail',
    connectionMode: 'live',
    eventsDensity: 'rich',
    terminalStatus: 'running',
    expanded: false,
    escalateError: false,
    showMetadataModules: false,
    metadataCompact: false,
    showStructuredAnnex: false,
  },
  parameters: withStoryDoc(
    'State test: active run with dense event stream. Evaluate scan speed and visual load.'
  ),
};

export const RunningSparseEvents = {
  args: {
    variantMode: 'subtle-rail',
    connectionMode: 'polling',
    eventsDensity: 'sparse',
    terminalStatus: 'running',
    expanded: false,
    escalateError: false,
    showMetadataModules: false,
    metadataCompact: false,
    showStructuredAnnex: false,
  },
  parameters: withStoryDoc(
    'State test: active run with sparse events. Validate empty-space handling and confidence signals.'
  ),
};

export const CompletedWithResult = {
  args: {
    variantMode: 'subtle-rail',
    connectionMode: 'idle',
    eventsDensity: 'rich',
    terminalStatus: 'completed',
    expanded: false,
    escalateError: false,
    showMetadataModules: false,
    metadataCompact: false,
    showStructuredAnnex: false,
  },
  parameters: withStoryDoc(
    'State test: terminal success. Check whether result readability clearly outweighs process chrome.'
  ),
};

export const FailedWithRecoveryHint = {
  args: {
    variantMode: 'subtle-rail',
    connectionMode: 'polling',
    eventsDensity: 'sparse',
    terminalStatus: 'failed',
    expanded: true,
    escalateError: true,
    showMetadataModules: false,
    metadataCompact: false,
  },
  parameters: withStoryDoc(
    'State test: terminal failure. Check escalation clarity and whether recovery/retry context is obvious.'
  ),
};

export const DashboardRichMetadata = {
  args: {
    variantMode: 'subtle-rail',
    connectionMode: 'idle',
    eventsDensity: 'rich',
    terminalStatus: 'completed',
    expanded: false,
    escalateError: false,
    showMetadataModules: true,
    metadataCompact: false,
    showStructuredAnnex: true,
  },
  parameters: withStoryDoc(
    'Status: Approved baseline. Dashboard layout with richer case-entry metadata cards and structured annex context (findings/timeline/conflicts/open questions) while preserving narrative result readability.'
  ),
};

export const DashboardRichMetadataCompact = {
  args: {
    variantMode: 'subtle-rail',
    connectionMode: 'idle',
    eventsDensity: 'rich',
    terminalStatus: 'completed',
    expanded: false,
    escalateError: false,
    showMetadataModules: true,
    metadataCompact: true,
    showStructuredAnnex: true,
  },
  parameters: withStoryDoc(
    'Status: Candidate. Compact density version for tighter detail pages. Preserves metadata completeness while reducing vertical space.'
  ),
};
