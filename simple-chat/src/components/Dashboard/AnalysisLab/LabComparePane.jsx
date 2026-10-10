import LabVariantReport from './LabVariantReport';
import LabDeltaStrip from './LabDeltaStrip';
import LabScorecardTable from './LabScorecardTable';
import { LAB_PROFILE_ORDER } from './labMeta';

export default function LabComparePane({ variants, comparison, onOpenFragments }) {
  return (
    <div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {LAB_PROFILE_ORDER.map((profileId) => (
          <LabVariantReport
            key={profileId}
            profileId={profileId}
            variant={variants?.[profileId] || null}
            onOpenFragments={onOpenFragments}
          />
        ))}
      </div>

      <LabDeltaStrip comparison={comparison} />
      <LabScorecardTable variants={variants} />
    </div>
  );
}
