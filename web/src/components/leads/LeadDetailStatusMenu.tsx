// web/src/components/leads/LeadDetailStatusMenu.tsx
//
// Dropdown menu for status transitions. Reuses LostReasonModal from Day 8.
// Convert option is disabled with tooltip (Day 10 wires it via the Actions toolbar).

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import {
  ALLOWED_TRANSITIONS,
  type LeadStatus,
} from '../../types/lead';
import { LeadStatusPill } from './LeadStatusPill';
import { LEAD_STATUS_CONFIG } from './LeadStatusPill.config';
import { LostReasonModal } from './LostReasonModal';
import { transitionLeadStatus, LeadServiceError } from '../../services/leadService';
import { humanizeError } from './LeadQuickAddModal.errorMapping';

interface Props {
  leadId: string;
  currentStatus: LeadStatus;
  /** Disable when another user holds the claim. */
  disabled: boolean;
  showToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
  onAfterChange: () => void;
}

export function LeadDetailStatusMenu({
  leadId,
  currentStatus,
  disabled,
  showToast,
  onAfterChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [showLostModal, setShowLostModal] = useState(false);
  const [pending, setPending] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const allowedTargets = ALLOWED_TRANSITIONS[currentStatus] as readonly LeadStatus[];

  async function applyTransition(to: LeadStatus, reason?: string) {
    setPending(true);
    try {
      await transitionLeadStatus(leadId, to, { reason });
      showToast(`Moved to ${LEAD_STATUS_CONFIG[to].label}`, 'success');
      onAfterChange();
    } catch (err) {
      showToast(humanizeError(err as LeadServiceError), 'error');
    } finally {
      setPending(false);
      setOpen(false);
      setShowLostModal(false);
    }
  }

  function handleSelect(to: LeadStatus) {
    if (to === 'LOST') {
      setOpen(false);
      setShowLostModal(true);
      return;
    }
    void applyTransition(to);
  }

  return (
    <>
      <div ref={rootRef} className="relative">
        <button
          type="button"
          data-testid="lead-detail-status-pill"
          onClick={() => !disabled && !pending && setOpen((v) => !v)}
          disabled={disabled || pending || allowedTargets.length === 0}
          aria-expanded={open}
          aria-haspopup="menu"
          title={disabled ? 'Held by another user' : 'Change status'}
          className={`
            inline-flex items-center gap-1.5 rounded-full transition-opacity
            ${disabled || allowedTargets.length === 0 ? 'opacity-60 cursor-not-allowed' : 'hover:opacity-80'}
          `}
        >
          <LeadStatusPill status={currentStatus} />
          {!disabled && allowedTargets.length > 0 && (
            <ChevronDown className={`h-3.5 w-3.5 text-white/40 transition-transform ${open ? 'rotate-180' : ''}`} />
          )}
        </button>

        {open && allowedTargets.length > 0 && (
          <div
            role="menu"
            className="absolute z-40 mt-2 w-48 rounded-lg border border-white/10 bg-[#15171c] shadow-xl p-1.5 left-0"
          >
            {allowedTargets.map((target) => {
              const cfg = LEAD_STATUS_CONFIG[target];
              return (
                <button
                  key={target}
                  type="button"
                  onClick={() => handleSelect(target)}
                  role="menuitem"
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-white/80 hover:bg-white/[0.05] text-left"
                >
                  <span className={`h-2 w-2 rounded-full ${cfg.dot}`} aria-hidden="true" />
                  <span className="flex-1">Move to {cfg.label}</span>
                  {target === currentStatus && <Check className="h-3.5 w-3.5" />}
                </button>
              );
            })}
            <div className="border-t border-white/10 mt-1 pt-1">
              <button
                type="button"
                disabled
                title="Use Convert to Booking (Day 10)"
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm text-white/30 cursor-not-allowed text-left"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-600/40" aria-hidden="true" />
                <span className="flex-1">Convert &amp; book</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <LostReasonModal
        isOpen={showLostModal}
        leadName=""
        onConfirm={(reason) => applyTransition('LOST', reason)}
        onCancel={() => setShowLostModal(false)}
      />
    </>
  );
}
