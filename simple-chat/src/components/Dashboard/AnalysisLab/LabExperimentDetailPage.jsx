import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DashboardShell from '../DashboardShell';
import LabSharedInputBanner from './LabSharedInputBanner';
import LabStatusBadge from './LabStatusBadge';
import LabComparePane from './LabComparePane';
import LabFragmentsPane from './LabFragmentsPane';
import LabRecordPane from './LabRecordPane';
import { useLabExperimentDetail } from '../../../hooks/useLabExperimentDetail';
import { LAB_PROFILE_ORDER } from './labMeta';

const TABS = [
  { id: 'compare', label: 'Usporedi izvještaje' },
  { id: 'fragments', label: 'Fragmenti i dokazi' },
  { id: 'record', label: 'Zapis eksperimenta' },
];

export default function LabExperimentDetailPage() {
  const { id } = useParams();
  const { experiment, comparison, loading, error, reload } = useLabExperimentDetail(id);
  const [activeTab, setActiveTab] = useState('compare');
  const [fragmentProfile, setFragmentProfile] = useState(null);

  const defaultFragmentProfile = useMemo(() => {
    const variants = experiment?.variants || {};
    const contextProfile = LAB_PROFILE_ORDER.find(
      (profileId) => profileId !== 'baseline-flat-v1' && variants[profileId]?.status === 'complete'
    );
    return contextProfile || 'baseline-flat-v1';
  }, [experiment]);

  const openFragments = (profileId) => {
    setFragmentProfile(profileId);
    setActiveTab('fragments');
  };

  const failedProfiles = useMemo(() => {
    const variants = experiment?.variants || {};
    return Object.entries(variants)
      .filter(([, variant]) => variant?.status === 'error')
      .map(([profileId]) => profileId);
  }, [experiment]);

  return (
    <DashboardShell>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--text-muted)]">Analitički laboratorij</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--text)]">
              Usporedba: {experiment?.inputSummary?.caseNumber || experiment?.evidencePackageRef || '…'}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {experiment && <LabStatusBadge status={experiment.status} />}
            <Link to="/dashboard/lab" className="text-sm text-[var(--text-muted)] underline hover:text-[var(--text)]">
              ← Sve usporedbe
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--text-muted)]">
            Učitavam usporedbu…
          </div>
        ) : error || !experiment ? (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            {error || 'Eksperiment nije pronađen.'}
            <button type="button" onClick={reload} className="ml-3 underline">
              Pokušaj ponovno
            </button>
          </div>
        ) : (
          <>
            {experiment.status === 'partial' && (
              <div role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                Djelomičan zapis: {failedProfiles.length > 0 ? `varijante (${failedProfiles.join(', ')}) nisu uspjele` : 'jedna varijanta nije uspjela'}.
                Uspješne varijante ostaju čitljive.
              </div>
            )}

            <LabSharedInputBanner
              evidencePackageHash={experiment.evidencePackageHash}
              inputSummary={experiment.inputSummary}
              match={comparison?.inputHashMatches}
            />

            <nav role="tablist" aria-label="Prikazi laboratorija" className="mt-6 flex gap-5 border-b border-[var(--border)]">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`lab-tab-${tab.id}`}
                  aria-selected={activeTab === tab.id}
                  aria-controls={`lab-pane-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={`border-b-2 px-0.5 pb-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 ${
                    activeTab === tab.id
                      ? 'border-[var(--text)] text-[var(--text)]'
                      : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            <div className="mt-5">
              {activeTab === 'compare' && (
                <section role="tabpanel" id="lab-pane-compare" aria-labelledby="lab-tab-compare">
                  <LabComparePane variants={experiment.variants} comparison={comparison} onOpenFragments={openFragments} />
                </section>
              )}
              {activeTab === 'fragments' && (
                <section role="tabpanel" id="lab-pane-fragments" aria-labelledby="lab-tab-fragments">
                  <LabFragmentsPane
                    variants={experiment.variants}
                    activeProfile={fragmentProfile || defaultFragmentProfile}
                    onProfileChange={setFragmentProfile}
                  />
                </section>
              )}
              {activeTab === 'record' && (
                <section role="tabpanel" id="lab-pane-record" aria-labelledby="lab-tab-record">
                  <LabRecordPane experiment={experiment} comparison={comparison} />
                </section>
              )}
            </div>
          </>
        )}
      </main>
    </DashboardShell>
  );
}
