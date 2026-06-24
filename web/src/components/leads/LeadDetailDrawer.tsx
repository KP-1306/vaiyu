// web/src/components/leads/LeadDetailDrawer.tsx
//
// Slide-in drawer that hosts all lead-editing surfaces. Auto-manages the
// claim lock via useLeadClaimLifecycle. URL-driven via ?lead=<id> in parent.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle, Trash2 } from 'lucide-react';
import { useLeadDetail } from '../../hooks/useLeadDetail';
import { useLeadClaimLifecycle } from '../../hooks/useLeadClaimLifecycle';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { LeadDetailHeader } from './LeadDetailHeader';
import { LeadDetailClaimBadge } from './LeadDetailClaimBadge';
import { LeadDetailActions } from './LeadDetailActions';
import { LeadDetailContactSection } from './LeadDetailContactSection';
import { LeadDetailBasicsSection } from './LeadDetailBasicsSection';
import { LeadDetailNotesSection } from './LeadDetailNotesSection';
import { LeadDetailTimeline } from './LeadDetailTimeline';
import { LeadDripPanel } from './LeadDripPanel';
import { LeadConvertModal } from './LeadConvertModal';
import { LeadPackageSuggestPanel } from './LeadPackageSuggestPanel';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  leadId: string | null;
  /** Hotel slug for routing (e.g. "View booking" after convert). */
  hotelSlug: string;
  currentUserId: string | null;
  /** When true, soft-delete + force-release controls render. */
  isManager: boolean;
  onClose: () => void;
  showToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
}

export function LeadDetailDrawer({
  leadId,
  hotelSlug,
  currentUserId,
  isManager,
  onClose,
  showToast,
}: Props) {
  const t = useOwnerT('owner-leads');
  const isOpen = !!leadId;
  const drawerRef = useRef<HTMLDivElement>(null);

  // Track which sections have unsaved edits (dirty flags) for close confirmation
  const [dirtySet, setDirtySet] = useState<Set<string>>(new Set());

  // Convert-to-booking modal state (stacks above drawer, z-50 over drawer z-40)
  const [convertOpen, setConvertOpen] = useState(false);
  const setDirty = useCallback((key: string) => (dirty: boolean) => {
    setDirtySet((prev) => {
      // Bail out when the flag is unchanged so we return the SAME Set
      // reference — otherwise a new Set every call forces a re-render, which
      // hands child sections a fresh onDirtyChange callback, re-fires their
      // effect, and spins an infinite render loop.
      if (dirty === prev.has(key)) return prev;
      const next = new Set(prev);
      if (dirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  // Data
  const detail = useLeadDetail(leadId);
  const { lead, events, isLeadLoading, isEventsLoading, isLeadError, leadError } = detail;

  // Claim lifecycle — pause heartbeat while any section is dirty so a network
  // blip during an edit doesn't reset the claim timer mid-flow.
  const { claim, isClaiming, forceRelease } = useLeadClaimLifecycle({
    leadId,
    currentUserId,
    isPaused: dirtySet.size > 0,
    onForceRelease: ({ byUserName }) =>
      showToast(t('drawer.claimReleasedBy', 'Your claim was released by {{name}}', { name: byUserName }), 'warning'),
  });

  // Reset dirty state when switching leads
  useEffect(() => {
    setDirtySet(new Set());
  }, [leadId]);

  // Focus trap
  useFocusTrap(drawerRef, isOpen);

  // Esc closes (with dirty confirmation)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, dirtySet]);

  const handleClose = useCallback(() => {
    if (dirtySet.size > 0) {
      const confirmed = window.confirm(
        t('drawer.unsavedConfirm', 'You have unsaved changes in {{count}} sections. Discard?', { count: dirtySet.size }),
      );
      if (!confirmed) return;
    }
    onClose();
  }, [dirtySet, onClose]);

  const handleForceRelease = useCallback(() => {
    if (!claim) return;
    const reason = window.prompt(
      t('drawer.forceReleasePrompt', "Force-release {{name}}'s claim?\nProvide a reason:", {
        name: claim.claimed_by_name ?? t('drawer.thisUser', 'this user'),
      }),
    );
    if (!reason || reason.trim() === '') return;
    forceRelease(reason).then(
      () => showToast(t('drawer.claimReleased', 'Claim released'), 'success'),
      (err) => showToast(t('drawer.couldNotRelease', 'Could not release: {{msg}}', { msg: (err as Error).message }), 'error'),
    );
  }, [claim, forceRelease, showToast]);

  // canEdit: drawer open + lead loaded + not deleted + we hold the claim (or no one does)
  const canEdit =
    !!lead &&
    lead.deleted_at === null &&
    (claim === null || claim.is_self || claim.is_expired || claim.claimed_by === null);

  return (
    <div
      className={`fixed inset-0 z-40 ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
      aria-hidden={!isOpen}
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={handleClose}
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('drawer.ariaLabel', 'Lead detail')}
        data-testid="lead-detail-drawer"
        className={`
          absolute inset-y-0 right-0 w-full sm:w-[480px] md:w-[540px] bg-[#0c0e13]
          border-l border-white/10 flex flex-col overflow-hidden
          transition-transform duration-200
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        {isLeadLoading || (isOpen && !lead && !isLeadError) ? (
          <DrawerLoading />
        ) : isLeadError || !lead ? (
          <DrawerError
            message={leadError?.message ?? t('drawer.loadFail', 'Could not load lead.')}
            onClose={handleClose}
          />
        ) : lead.deleted_at !== null ? (
          <DrawerDeleted leadName={lead.contact_name} onClose={handleClose} />
        ) : (
          <>
            <LeadDetailHeader
              lead={lead}
              canEdit={canEdit}
              showToast={showToast}
              onAfterChange={() => detail.refetchLead()}
              onClose={handleClose}
              closeDisabled={false}
            />
            <LeadDetailClaimBadge
              claim={claim}
              canForceRelease={isManager && !!claim && !!claim.claimed_by && !claim.is_self}
              onForceRelease={handleForceRelease}
            />
            {isClaiming && !claim && (
              <div className="px-4 py-2 text-xs text-white/40 flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t('drawer.acquiringClaim', 'Acquiring claim…')}
              </div>
            )}
            <div className="flex-1 overflow-y-auto">
              <LeadDetailActions
                lead={lead}
                currentUserId={currentUserId}
                canEdit={canEdit}
                isManager={isManager}
                showToast={showToast}
                onAfterAction={() => detail.refetchLead()}
                onAfterDelete={onClose}
                onOpenConvert={() => setConvertOpen(true)}
              />
              <LeadDetailContactSection
                lead={lead}
                canEdit={canEdit}
                showToast={showToast}
                onDirtyChange={setDirty('contact')}
                onSavedRefresh={() => detail.refetchLead()}
              />
              <LeadDetailBasicsSection
                lead={lead}
                canEdit={canEdit}
                showToast={showToast}
                onDirtyChange={setDirty('basics')}
                onSavedRefresh={() => detail.refetchLead()}
              />
              <LeadDetailNotesSection
                leadId={lead.id}
                events={events}
                canEdit={canEdit}
                showToast={showToast}
              />
              <LeadPackageSuggestPanel lead={lead} />
              <LeadDripPanel leadId={lead.id} hotelId={lead.hotel_id} />
              <LeadDetailTimeline events={events} isLoading={isEventsLoading} />
            </div>
          </>
        )}
      </div>

      {/* Convert-to-booking modal (stacks above drawer) */}
      {lead && lead.deleted_at === null && (
        <LeadConvertModal
          lead={lead}
          hotelId={lead.hotel_id}
          hotelSlug={hotelSlug}
          isOpen={convertOpen}
          onClose={() => setConvertOpen(false)}
          showToast={showToast}
        />
      )}
    </div>
  );
}

function DrawerLoading() {
  const t = useOwnerT('owner-leads');
  return (
    <div className="flex-1 flex items-center justify-center text-white/50">
      <Loader2 className="h-5 w-5 animate-spin mr-2" />
      {t('drawer.loading', 'Loading…')}
    </div>
  );
}

function DrawerError({ message, onClose }: { message: string; onClose: () => void }) {
  const t = useOwnerT('owner-leads');
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <AlertCircle className="h-8 w-8 text-red-400 mb-3" />
      <div className="text-white font-medium mb-1">{t('drawer.errTitle', 'Could not load lead')}</div>
      <div className="text-sm text-white/60 mb-4">{message}</div>
      <button
        type="button"
        onClick={onClose}
        className="px-3 py-1.5 rounded-md bg-white/10 text-white text-sm hover:bg-white/20"
      >
        {t('drawer.close', 'Close')}
      </button>
    </div>
  );
}

function DrawerDeleted({ leadName, onClose }: { leadName: string; onClose: () => void }) {
  const t = useOwnerT('owner-leads');
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <Trash2 className="h-8 w-8 text-white/40 mb-3" />
      <div className="text-white font-medium mb-1">{t('drawer.deletedTitle', 'Lead deleted')}</div>
      <div className="text-sm text-white/60 mb-4">
        {t('drawer.deletedBody', '"{{name}}" was removed. Audit history is preserved.', { name: leadName })}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="px-3 py-1.5 rounded-md bg-white/10 text-white text-sm hover:bg-white/20"
      >
        {t('drawer.close', 'Close')}
      </button>
    </div>
  );
}
