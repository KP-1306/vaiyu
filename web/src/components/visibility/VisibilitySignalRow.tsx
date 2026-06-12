// web/src/components/visibility/VisibilitySignalRow.tsx
//
// One row in the breakdown panel. Renders status pill + fix-action button.
// For self-attested signals, owner can self-attest / unclaim inline. Manager
// verify/unverify happens via proper modal dialogs (no native prompts).
//
// Surfaces:
//   • Attested-on date (SELF_ATTESTED rows)
//   • Verified-on date (MANAGER_VERIFIED rows)
//   • "Expires in N days" warning when ≤14 days from 90-day expiry
//   • Re-attest-over-verified confirm dialog (prevents accidental wipe)

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  ExternalLink,
  HelpCircle,
  Loader2,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

import {
  VISIBILITY_SIGNALS,
  isExternalFixAction,
  resolveFixAction,
} from '../../config/visibilityScore';
import { visibilityScoreQueryKeys } from '../../services/visibilityScoreQueryKeys';
import {
  managerUnverifyAttestation,
  managerVerifyAttestation,
  setVisibilityAttestation,
} from '../../services/visibilityScoreService';
import {
  VisibilityServiceError,
  type HotelVisibilityAttestation,
  type VisibilitySignalDetail,
} from '../../types/visibilityScore';
import { UnverifyDialog } from './UnverifyDialog';
import { ReattestConfirmDialog } from './ReattestConfirmDialog';

interface Props {
  hotelId: string;
  hotelSlug: string;
  signal: VisibilitySignalDetail;
  attestation?: HotelVisibilityAttestation | null;
  isManager: boolean;
}

const EXPIRY_WARN_WINDOW_DAYS = 14;

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso).getTime() + 90 * 24 * 60 * 60 * 1000;
  const diff = target - Date.now();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function VisibilitySignalRow({ hotelId, hotelSlug, signal, attestation, isManager }: Props) {
  // Forward compatibility: a newer formula version (deployed DB-side first) may
  // return a signal key this bundle's catalog doesn't know yet. Fall back to a
  // generic entry derived from the SQL payload instead of crashing the page.
  const meta = VISIBILITY_SIGNALS[signal.key] ?? {
    key: signal.key,
    category: signal.category,
    kind: signal.kind,
    labelEn: String(signal.key).replace(/_/g, ' '),
    labelHi: String(signal.key).replace(/_/g, ' '),
    descEn: signal.reason ?? '',
    descHi: signal.reason ?? '',
    fixActionPath: '/owner/:slug/settings',
    fixActionLabelEn: 'Open settings',
    fixActionLabelHi: 'Settings kholiye',
  };
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [showEvidenceInput, setShowEvidenceInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverifyOpen, setUnverifyOpen] = useState(false);
  const [reattestOpen, setReattestOpen] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: visibilityScoreQueryKeys.score(hotelId) });
    qc.invalidateQueries({ queryKey: visibilityScoreQueryKeys.attestations(hotelId) });
  };

  const attestMut = useMutation({
    mutationFn: (state: 'SELF_ATTESTED' | 'UNCLAIMED') =>
      setVisibilityAttestation(
        hotelId,
        signal.key,
        state,
        state === 'SELF_ATTESTED' ? evidenceUrl.trim() || null : null,
      ),
    onSuccess: () => {
      invalidate();
      setShowEvidenceInput(false);
      setEvidenceUrl('');
      setReattestOpen(false);
      setError(null);
    },
    onError: (e: unknown) => {
      if (e instanceof VisibilityServiceError && e.code === 'EVIDENCE_URL_NOT_ALLOWED') {
        setError('Evidence URL must point to the official Google Business or supported review platform.');
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError('Failed to update.');
      }
    },
  });
  const verifyMut = useMutation({
    mutationFn: () => managerVerifyAttestation(hotelId, signal.key, null),
    onSuccess: invalidate,
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to verify.'),
  });
  const unverifyMut = useMutation({
    mutationFn: (reason: string) => managerUnverifyAttestation(hotelId, signal.key, reason),
    onSuccess: () => { invalidate(); setUnverifyOpen(false); setError(null); },
    onError: (e: unknown) => {
      if (e instanceof VisibilityServiceError && e.code === 'ATTESTATION_LOCKED') {
        setError('Only the manager who verified this can unverify it.');
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError('Failed to unverify.');
      }
    },
  });

  const onFixAction = () => {
    const href = resolveFixAction(meta, hotelSlug);
    if (isExternalFixAction(meta)) window.open(href, '_blank', 'noopener,noreferrer');
    else navigate(href);
  };

  const onSelfAttestClick = () => {
    setError(null);
    // If a manager verification is active, warn before wiping it
    if (signal.state === 'MANAGER_VERIFIED' && attestation?.manager_verified_at) {
      setReattestOpen(true);
    } else {
      setShowEvidenceInput((v) => !v);
    }
  };

  // ─── Status icon + tone classes ────────────────────────────────────────────
  let StatusIcon = HelpCircle;
  let toneText = 'text-slate-400';
  let statusLabel = 'Not yet set';
  if (!signal.included) {
    StatusIcon = HelpCircle;
    toneText = 'text-sky-300';
    statusLabel = 'Pending data';
  } else if (signal.kind === 'AUTO_DERIVED') {
    if (signal.satisfied) {
      StatusIcon = CheckCircle2;
      toneText = 'text-emerald-300';
      statusLabel = 'Pass';
    } else {
      StatusIcon = XCircle;
      toneText = 'text-rose-300';
      statusLabel = 'Fail';
    }
  } else {
    // SELF_ATTESTED
    if (signal.state === 'MANAGER_VERIFIED') {
      StatusIcon = ShieldCheck;
      toneText = 'text-emerald-300';
      statusLabel = 'Verified';
    } else if (signal.state === 'SELF_ATTESTED') {
      StatusIcon = CheckCircle2;
      toneText = 'text-amber-300';
      statusLabel = 'Self-attested';
    } else {
      StatusIcon = Circle;
      toneText = 'text-slate-400';
      statusLabel = 'Not yet claimed';
    }
  }

  const showSelfAttestControls = signal.kind === 'SELF_ATTESTED';
  const verifiedDaysLeft =
    signal.state === 'MANAGER_VERIFIED' && attestation?.manager_verified_at
      ? daysUntil(attestation.manager_verified_at)
      : null;
  const expiryWarning =
    verifiedDaysLeft !== null && verifiedDaysLeft <= EXPIRY_WARN_WINDOW_DAYS;

  return (
    <li className="rounded-lg border border-slate-800 bg-[#0B0E14] px-3 py-2.5">
      <div className="flex items-start gap-3">
        <StatusIcon className={`mt-0.5 h-4 w-4 shrink-0 ${toneText}`} aria-hidden />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="text-[12px] font-medium text-slate-100">{meta.labelEn}</span>
            <span className={`text-[10px] uppercase tracking-wide ${toneText}`}>
              {statusLabel}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">{signal.reason}</p>

          {/* Bookkeeping line: attested/verified dates */}
          {showSelfAttestControls && attestation && (
            <p className="mt-0.5 text-[10px] text-slate-500">
              {attestation.state === 'MANAGER_VERIFIED' && attestation.manager_verified_at && (
                <>Verified {formatDate(attestation.manager_verified_at)}</>
              )}
              {attestation.state === 'SELF_ATTESTED' && attestation.attested_at && (
                <>Self-attested {formatDate(attestation.attested_at)}</>
              )}
              {attestation.evidence_url && (
                <>
                  {' · '}
                  <a
                    href={attestation.evidence_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 underline hover:text-slate-200"
                  >
                    Evidence link
                  </a>
                </>
              )}
            </p>
          )}

          {/* Expiry warning */}
          {expiryWarning && verifiedDaysLeft !== null && (
            <p
              className="mt-1 inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300"
              data-testid={`signal-${signal.key}-expiry-warning`}
            >
              <AlertTriangle className="h-3 w-3" />
              {verifiedDaysLeft <= 0
                ? 'Verification has expired — re-verify to restore full credit.'
                : `Verification expires in ${verifiedDaysLeft} day${verifiedDaysLeft === 1 ? '' : 's'}.`}
            </p>
          )}

          {/* Score footer */}
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] text-slate-500">
            <span>
              +{signal.contribution.toFixed(signal.contribution % 1 === 0 ? 0 : 1)} / {signal.max_contribution} pts
              {!signal.included && ' (excluded)'}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {showSelfAttestControls && signal.state === 'UNCLAIMED' && (
                <button
                  type="button"
                  onClick={() => setShowEvidenceInput((v) => !v)}
                  className="rounded border border-amber-500/40 px-2 py-0.5 text-[10px] text-amber-300 hover:bg-amber-500/10"
                  data-testid={`signal-${signal.key}-self-attest`}
                >
                  Self-attest
                </button>
              )}
              {showSelfAttestControls && signal.state === 'SELF_ATTESTED' && (
                <button
                  type="button"
                  onClick={() => attestMut.mutate('UNCLAIMED')}
                  disabled={attestMut.isPending}
                  className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800"
                  data-testid={`signal-${signal.key}-unclaim`}
                >
                  Unclaim
                </button>
              )}
              {showSelfAttestControls && signal.state === 'MANAGER_VERIFIED' && (
                <button
                  type="button"
                  onClick={onSelfAttestClick}
                  className="rounded border border-amber-500/40 px-2 py-0.5 text-[10px] text-amber-300 hover:bg-amber-500/10"
                  data-testid={`signal-${signal.key}-reattest`}
                >
                  Re-attest
                </button>
              )}
              {showSelfAttestControls && isManager && signal.state === 'SELF_ATTESTED' && (
                <button
                  type="button"
                  onClick={() => verifyMut.mutate()}
                  disabled={verifyMut.isPending}
                  className="rounded border border-emerald-500/40 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/10"
                  data-testid={`signal-${signal.key}-verify`}
                >
                  {verifyMut.isPending ? <Loader2 className="h-3 w-3 animate-spin inline" /> : 'Verify'}
                </button>
              )}
              {showSelfAttestControls && isManager && signal.state === 'MANAGER_VERIFIED' && (
                <button
                  type="button"
                  onClick={() => { setError(null); setUnverifyOpen(true); }}
                  className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800"
                  data-testid={`signal-${signal.key}-unverify`}
                >
                  Unverify
                </button>
              )}
              <button
                type="button"
                onClick={onFixAction}
                className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-slate-800"
                data-testid={`signal-${signal.key}-fix`}
              >
                {meta.fixActionLabelEn}
                {isExternalFixAction(meta) ? (
                  <ExternalLink className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
              </button>
            </div>
          </div>

          {showEvidenceInput && signal.kind === 'SELF_ATTESTED' && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="url"
                value={evidenceUrl}
                onChange={(e) => setEvidenceUrl(e.target.value)}
                placeholder="Optional evidence URL (Google Business / review platform)"
                className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-500"
                data-testid={`signal-${signal.key}-evidence-input`}
              />
              <button
                type="button"
                onClick={() => attestMut.mutate('SELF_ATTESTED')}
                disabled={attestMut.isPending}
                className="rounded bg-amber-500/20 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-500/30"
                data-testid={`signal-${signal.key}-self-attest-confirm`}
              >
                Confirm self-attest
              </button>
              <button
                type="button"
                onClick={() => { setShowEvidenceInput(false); setEvidenceUrl(''); }}
                className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          )}

          {error && (
            <p className="mt-1 text-[10px] text-rose-300" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>

      <UnverifyDialog
        open={unverifyOpen}
        signalLabel={meta.labelEn}
        busy={unverifyMut.isPending}
        errorText={unverifyMut.isError ? error : null}
        onCancel={() => setUnverifyOpen(false)}
        onConfirm={(reason) => unverifyMut.mutate(reason)}
      />
      <ReattestConfirmDialog
        open={reattestOpen}
        signalLabel={meta.labelEn}
        verifiedAtIso={attestation?.manager_verified_at ?? null}
        busy={false}
        onCancel={() => setReattestOpen(false)}
        onConfirm={() => { setReattestOpen(false); setShowEvidenceInput(true); }}
      />
    </li>
  );
}
