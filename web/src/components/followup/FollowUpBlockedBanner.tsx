// web/src/components/followup/FollowUpBlockedBanner.tsx
//
// Two reusable banners used by the Follow-up Radar workspace.
//
//   <FollowUpDisclaimerBanner />  — page-level disclaimer. v0 sends nothing.
//   <FollowUpBlockedWarning />    — row-level red warning for blocked items.
//                                   Reused in the compact dashboard card if any
//                                   critical-blocked items exist.
//
// All copy is English + Hinglish per the brief.

import { AlertTriangle, Info } from 'lucide-react';
import { useOwnerT } from '../../i18n/useOwnerT';

export function FollowUpDisclaimerBanner() {
  const t = useOwnerT('owner-followup');
  return (
    <div
      role="note"
      className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-100"
    >
      <div className="flex items-start gap-3">
        <Info className="h-4 w-4 mt-0.5 shrink-0 text-amber-300" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium text-amber-100">
            {t('disclaimer.title', 'Follow-up Radar v0 is a manual reminder workspace.')}
          </p>
          <p className="text-amber-100/80">
            {t('disclaimer.body', 'It does not send messages, update tickets, or automate guest communication. Use this view to decide what to do next — the action itself stays with you.')}
          </p>
          <p className="text-amber-100/70 italic">
            {t('disclaimer.hinglish', 'Yeh radar batata hai kaunse follow-up aaj karne hain aur kaunse guest issue solve hone tak rokne chahiye.')}
          </p>
        </div>
      </div>
    </div>
  );
}

interface BlockedWarningProps {
  reason: string;
  className?: string;
}

export function FollowUpBlockedWarning({ reason, className }: BlockedWarningProps) {
  const t = useOwnerT('owner-followup');
  return (
    <div
      role="alert"
      className={`rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-100 ${
        className ?? ''
      }`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-300" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium text-red-100">
            {t('blocked.title', 'Outreach blocked — resolve guest issue first.')}
          </p>
          <p className="text-red-100/80">{reason}</p>
          <p className="text-red-100/70 italic">
            {t('blocked.hinglish', 'Pehle guest issue solve karein. Tab tak guest ko sales outreach mat bhejein.')}
          </p>
        </div>
      </div>
    </div>
  );
}
