// web/src/hooks/useLeadClaimLifecycle.ts
//
// Manages the claim lock for the currently-open lead detail:
//   - Acquires claim on mount (or lead change)
//   - Refreshes every HEARTBEAT_INTERVAL_MS while drawer is open (and not paused)
//   - Releases claim on unmount or lead change
//   - Detects force-release events from realtime and fires onForceRelease
//
// Pure helpers (shouldHeartbeat, isForcedReleaseEvent) extracted for unit tests.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  claimLead,
  releaseClaim,
  forceReleaseClaim,
  getLeadClaimStatus,
} from '../services/leadService';
import type { ClaimStatus, LeadEvent } from '../types/lead';
import { useLeadEventsRealtime } from './useLeadEventsRealtime';

/** Refresh interval — 10 min with 5-min buffer against the 15-min server TTL. */
export const HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;

// ─── Pure helpers (tested) ────────────────────────────────────────────────

export function shouldHeartbeat(
  claim: ClaimStatus | null,
  isPaused: boolean,
): boolean {
  if (isPaused) return false;
  if (!claim) return false;
  if (!claim.is_self) return false;
  if (claim.is_expired) return false;
  return true;
}

export function isForcedReleaseEvent(
  event: { event_type: string; payload: Record<string, unknown> },
  currentUserId: string | null,
): boolean {
  if (event.event_type !== 'CLAIM_RELEASED') return false;
  const payload = event.payload as { release_type?: string; prev_holder?: string };
  if (payload.release_type !== 'forced') return false;
  if (!currentUserId) return false;
  return payload.prev_holder === currentUserId;
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export interface UseLeadClaimLifecycleOpts {
  leadId: string | null;
  currentUserId: string | null;
  /** Skip heartbeat (e.g. while user is editing a section to avoid resetting timer mid-flow). */
  isPaused?: boolean;
  /** Called when this user's claim is force-released by another (manager). */
  onForceRelease?: (info: { byUserName: string }) => void;
}

export interface UseLeadClaimLifecycleResult {
  claim: ClaimStatus | null;
  isClaiming: boolean;
  /** Manager-only path; UI gates the button. */
  forceRelease: (reason: string) => Promise<void>;
  /** Read-only refetch (e.g. after another tab releases). */
  refetchClaim: () => Promise<void>;
}

export function useLeadClaimLifecycle({
  leadId,
  currentUserId,
  isPaused = false,
  onForceRelease,
}: UseLeadClaimLifecycleOpts): UseLeadClaimLifecycleResult {
  const queryClient = useQueryClient();
  const [claim, setClaim] = useState<ClaimStatus | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onForceReleaseRef = useRef(onForceRelease);
  onForceReleaseRef.current = onForceRelease;

  // ── Acquire on mount / lead change ──
  useEffect(() => {
    if (!leadId) {
      setClaim(null);
      return;
    }
    let cancelled = false;
    setIsClaiming(true);
    claimLead(leadId)
      .then((result) => {
        if (!cancelled) setClaim(result);
      })
      .catch(() => {
        // Soft-deleted or NOT_AUTHORIZED — drawer will show appropriate state
        if (!cancelled) setClaim(null);
      })
      .finally(() => {
        if (!cancelled) setIsClaiming(false);
      });

    return () => {
      cancelled = true;
      // Best-effort release on unmount — don't await; fire-and-forget
      releaseClaim(leadId).catch(() => {
        // Swallow — drawer is closing anyway
      });
    };
  }, [leadId]);

  // ── Heartbeat while self-held ──
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (!leadId) return;
    if (!shouldHeartbeat(claim, isPaused)) return;

    intervalRef.current = setInterval(() => {
      claimLead(leadId)
        .then((result) => setClaim(result))
        .catch(() => {
          // Network blip; next interval will retry
        });
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [leadId, claim, isPaused]);

  // ── Realtime: detect force-release on this lead ──
  const onRealtimeEvent = useCallback(
    (eventType: string, payload: Record<string, unknown>) => {
      if (!leadId) return;
      const fake: LeadEvent = {
        event_type: eventType,
        payload,
      } as unknown as LeadEvent;
      if (isForcedReleaseEvent(fake, currentUserId)) {
        // We were displaced. Drop local claim and notify.
        setClaim((prev) => (prev ? { ...prev, claimed_by: null, is_self: false, is_expired: true } : null));
        const byUserName = (payload.by_user_name as string) || 'a manager';
        if (onForceReleaseRef.current) {
          onForceReleaseRef.current({ byUserName });
        }
      }
    },
    [leadId, currentUserId],
  );

  useLeadEventsRealtime(leadId ?? undefined, { onEvent: onRealtimeEvent });

  // ── Force release (manager-only) ──
  const forceRelease = useCallback(
    async (reason: string) => {
      if (!leadId) return;
      const result = await forceReleaseClaim(leadId, reason);
      setClaim(result);
    },
    [leadId],
  );

  const refetchClaim = useCallback(async () => {
    if (!leadId) return;
    try {
      const fresh = await getLeadClaimStatus(leadId);
      setClaim(fresh);
      // Also nudge cache so other hooks see fresh state
      queryClient.invalidateQueries({ queryKey: ['lead-claim', leadId] });
    } catch {
      // ignore
    }
  }, [leadId, queryClient]);

  return { claim, isClaiming, forceRelease, refetchClaim };
}
