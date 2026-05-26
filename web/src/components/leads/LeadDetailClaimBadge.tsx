// web/src/components/leads/LeadDetailClaimBadge.tsx

import { useEffect, useState } from 'react';
import { Lock, ShieldAlert } from 'lucide-react';
import type { ClaimStatus } from '../../types/lead';

interface Props {
  claim: ClaimStatus | null;
  /** Manager: show "Force release" button. */
  canForceRelease: boolean;
  onForceRelease?: () => void;
}

function formatRemaining(expiresAt: string): string {
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(diffMs) || diffMs <= 0) return 'expiring';
  const min = Math.round(diffMs / 60000);
  if (min < 1) return '<1 min remaining';
  return `${min} min remaining`;
}

export function LeadDetailClaimBadge({ claim, canForceRelease, onForceRelease }: Props) {
  // Re-render every minute so the countdown updates
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!claim || !claim.claimed_by || claim.is_expired) return null;

  if (claim.is_self) {
    return (
      <div
        data-testid="lead-detail-claim-badge"
        className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border-y border-emerald-500/20 text-xs text-emerald-300"
      >
        <Lock className="h-3.5 w-3.5" />
        <span>
          You&apos;re working on this · {claim.claim_expires_at ? formatRemaining(claim.claim_expires_at) : ''}
        </span>
      </div>
    );
  }

  return (
    <div
      data-testid="lead-detail-claim-badge"
      className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-y border-amber-500/20 text-xs text-amber-200"
    >
      <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">
        Currently being worked by <span className="font-semibold">{claim.claimed_by_name ?? 'someone'}</span>
        {claim.claim_expires_at ? ` · ${formatRemaining(claim.claim_expires_at)}` : ''}
      </span>
      {canForceRelease && onForceRelease && (
        <button
          type="button"
          onClick={onForceRelease}
          className="text-amber-100 hover:text-white underline-offset-2 hover:underline shrink-0"
        >
          Force release
        </button>
      )}
    </div>
  );
}
