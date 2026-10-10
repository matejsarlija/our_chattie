import LabVariantReport from './LabVariantReport';
import LabDeltaStrip from './LabDeltaStrip';
import LabScorecardTable from './LabScorecardTable';
import { LAB_PROFILE_ORDER } from './labMeta';


export default function LabComparePane({ variants, comparison, onOpenFragments }) {
  return (
    <div className="space-y-5">
      <LabScorecardTable variants={variants} />
      <LabDeltaStrip comparison={comparison} />

      <section aria-labelledby="lab-variant-reports-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="lab-variant-reports-title" className="text-lg font-semibold text-[var(--text)]">
              Izvještaji po varijanti
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Sažetak je vidljiv odmah; otvorite izvještaj za narativ, nalaze i pitanja.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          {LAB_PROFILE_ORDER.map((profileId) => (
            <LabVariantReport
              key={profileId}
              profileId={profileId}
              variant={variants?.[profileId] || null}
              onOpenFragments={onOpenFragments}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
