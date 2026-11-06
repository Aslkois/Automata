// The difficulty tier of a starter drone, shown next to its name. Drones the player created or
// imported carry no badge.
import { COMPLEXITY_LABEL, starterInfo } from '../data/defaults';

export function TierBadge({ designId }: { designId: string }) {
  const info = starterInfo(designId);
  if (!info) return null;
  return (
    <span className={`tier-badge tier-${info.complexity}`} title={`${COMPLEXITY_LABEL[info.complexity]} starter: ${info.role}`} data-testid="tier-badge">
      {COMPLEXITY_LABEL[info.complexity]}
    </span>
  );
}
