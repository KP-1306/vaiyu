// web/src/components/visibility/GBPChecklistRow.tsx
//
// One row in the GBP Checklist surface for net-new items
// (SELF_ATTESTED and AUTO_DERIVED). LINKED_VISIBILITY items render via
// VisibilitySignalRow instead (single-source-of-truth with Visibility).
//
// Attest/verify/unverify flows mirror VisibilitySignalRow.

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  HelpCircle,
  Loader2,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

import {
  gbpFixActionRoute,
  GBP_FIX_MODULE_LABEL,
} from '../../config/gbpChecklist';
import { useOwnerT, useOwnerLang } from '../../i18n/useOwnerT';
import { gbpChecklistQueryKeys } from '../../services/gbpChecklistQueryKeys';
import {
  managerUnverifyGBPAttestation,
  managerVerifyGBPAttestation,
  setGBPAttestation,
} from '../../services/gbpChecklistService';
import { GBPServiceError, type GBPAttestationRow, type GBPCatalogItem } from '../../types/gbpChecklist';
import { UnverifyDialog } from './UnverifyDialog';

interface Props {
  hotelId: string;
  hotelSlug: string;
  item: GBPCatalogItem;
  /** For SELF_ATTESTED items: existing attestation row or null. */
  attestation: GBPAttestationRow | null;
  /** For AUTO_DERIVED items: whether the underlying rule is satisfied. */
  autoSatisfied?: boolean;
  /** Note for AUTO_DERIVED items, e.g. "30+ chars" or "3+ amenities". */
  autoReason?: string;
  isManager: boolean;
}

const EXPIRY_WARN_DAYS = 14;

function daysUntilExpiry(verifiedAtIso: string | null): number | null {
  if (!verifiedAtIso) return null;
  const target = new Date(verifiedAtIso).getTime() + 90 * 24 * 60 * 60 * 1000;
  return Math.ceil((target - Date.now()) / (24 * 60 * 60 * 1000));
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function GBPChecklistRow({
  hotelId,
  hotelSlug,
  item,
  attestation,
  autoSatisfied,
  autoReason,
  isManager,
}: Props) {
  const t = useOwnerT('owner-visibility');
  const lang = useOwnerLang();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [showEvidenceInput, setShowEvidenceInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverifyOpen, setUnverifyOpen] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: gbpChecklistQueryKeys.hotel(hotelId) });
  };

  const attestMut = useMutation({
    mutationFn: (state: 'SELF_ATTESTED' | 'UNCLAIMED') =>
      setGBPAttestation({
        hotelId,
        itemKey: item.itemKey,
        state,
        evidenceUrl: state === 'SELF_ATTESTED' ? evidenceUrl.trim() || null : null,
      }),
    onSuccess: () => {
      invalidate();
      setShowEvidenceInput(false);
      setEvidenceUrl('');
      setError(null);
    },
    onError: (e: unknown) => {
      if (e instanceof GBPServiceError) setError(e.message);
      else setError(e instanceof Error ? e.message : 'Failed to update.');
    },
  });

  const verifyMut = useMutation({
    mutationFn: () => managerVerifyGBPAttestation({ hotelId, itemKey: item.itemKey, note: null }),
    onSuccess: invalidate,
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to verify.'),
  });

  const unverifyMut = useMutation({
    mutationFn: (reason: string) => managerUnverifyGBPAttestation({ hotelId, itemKey: item.itemKey, reason }),
    onSuccess: () => { invalidate(); setUnverifyOpen(false); setError(null); },
    onError: (e: unknown) => {
      if (e instanceof GBPServiceError && e.code === 'ATTESTATION_LOCKED') {
        setError(t('error.unverifyLocked', 'Only the manager who verified this can unverify it.'));
      } else {
        setError(e instanceof Error ? e.message : t('error.unverifyFailed', 'Failed to unverify.'));
      }
    },
  });

  // ─── Status icon + tone ───────────────────────────────────────────────────
  let StatusIcon = HelpCircle;
  let toneText = 'text-slate-400';
  let statusLabel = t('status.notYetSet', 'Not yet set');

  if (item.kind === 'AUTO_DERIVED') {
    if (autoSatisfied) {
      StatusIcon = CheckCircle2;
      toneText = 'text-emerald-300';
      statusLabel = t('status.pass', 'Pass');
    } else {
      StatusIcon = XCircle;
      toneText = 'text-rose-300';
      statusLabel = t('status.fail', 'Fail');
    }
  } else {
    // SELF_ATTESTED
    const state = attestation?.state ?? 'UNCLAIMED';
    if (state === 'MANAGER_VERIFIED') {
      // Check expiry
      const daysLeft = daysUntilExpiry(attestation?.manager_verified_at ?? null);
      if (daysLeft !== null && daysLeft <= 0) {
        StatusIcon = AlertTriangle;
        toneText = 'text-amber-300';
        statusLabel = t('status.verificationExpired', 'Verification expired');
      } else {
        StatusIcon = ShieldCheck;
        toneText = 'text-emerald-300';
        statusLabel = t('status.verified', 'Verified');
      }
    } else if (state === 'SELF_ATTESTED') {
      StatusIcon = CheckCircle2;
      toneText = 'text-amber-300';
      statusLabel = t('status.selfAttested', 'Self-attested');
    } else {
      StatusIcon = Circle;
      toneText = 'text-slate-400';
      statusLabel = t('status.notYetClaimed', 'Not yet claimed');
    }
  }

  const onFixAction = () => navigate(gbpFixActionRoute(hotelSlug, item.fixModule));

  const showSelfAttestControls = item.kind === 'SELF_ATTESTED';
  const state = attestation?.state ?? 'UNCLAIMED';
  const verifiedDaysLeft = daysUntilExpiry(attestation?.manager_verified_at ?? null);
  const expiryWarning = state === 'MANAGER_VERIFIED' &&
    verifiedDaysLeft !== null && verifiedDaysLeft <= EXPIRY_WARN_DAYS;

  return (
    <li className="rounded-lg border border-slate-800 bg-[#0B0E14] px-3 py-2.5">
      <div className="flex items-start gap-3">
        <StatusIcon className={`mt-0.5 h-4 w-4 shrink-0 ${toneText}`} aria-hidden />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="text-[12px] font-medium text-slate-100">{lang === 'hi' ? item.labelHi : item.labelEn}</span>
            <span className={`text-[10px] uppercase tracking-wide ${toneText}`}>{statusLabel}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {item.kind === 'AUTO_DERIVED' && autoReason ? autoReason : (lang === 'hi' ? item.descHi : item.descEn)}
          </p>

          {showSelfAttestControls && attestation && (
            <p className="mt-0.5 text-[10px] text-slate-500">
              {attestation.state === 'MANAGER_VERIFIED' && attestation.manager_verified_at && (
                <>{t('attest.verifiedOn', 'Verified {{date}}', { date: formatDate(attestation.manager_verified_at) })}</>
              )}
              {attestation.state === 'SELF_ATTESTED' && attestation.attested_at && (
                <>{t('attest.selfAttestedOn', 'Self-attested {{date}}', { date: formatDate(attestation.attested_at) })}</>
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
                    {t('attest.evidenceLink', 'Evidence link')}
                  </a>
                </>
              )}
            </p>
          )}

          {expiryWarning && verifiedDaysLeft !== null && (
            <p className="mt-1 inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
              <AlertTriangle className="h-3 w-3" />
              {verifiedDaysLeft <= 0
                ? t('expiry.expired', 'Verification has expired — re-verify to restore full credit.')
                : t('expiry.expiresIn', 'Verification expires in {{count}} day.', { count: verifiedDaysLeft })}
            </p>
          )}

          {/* Action row */}
          <div className="mt-1 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[10px] text-slate-500">
            <div className="flex flex-wrap items-center gap-2">
              {showSelfAttestControls && state === 'UNCLAIMED' && (
                <button
                  type="button"
                  onClick={() => setShowEvidenceInput((v) => !v)}
                  className="rounded border border-amber-500/40 px-2 py-0.5 text-[10px] text-amber-300 hover:bg-amber-500/10"
                >
                  {t('attest.selfAttest', 'Self-attest')}
                </button>
              )}
              {showSelfAttestControls && state === 'SELF_ATTESTED' && (
                <button
                  type="button"
                  onClick={() => attestMut.mutate('UNCLAIMED')}
                  disabled={attestMut.isPending}
                  className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800"
                >
                  {t('attest.unclaim', 'Unclaim')}
                </button>
              )}
              {showSelfAttestControls && isManager && state === 'SELF_ATTESTED' && (
                <button
                  type="button"
                  onClick={() => verifyMut.mutate()}
                  disabled={verifyMut.isPending}
                  className="rounded border border-emerald-500/40 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/10"
                >
                  {verifyMut.isPending ? <Loader2 className="h-3 w-3 animate-spin inline" /> : t('attest.verify', 'Verify')}
                </button>
              )}
              {showSelfAttestControls && isManager && state === 'MANAGER_VERIFIED' && (
                <button
                  type="button"
                  onClick={() => { setError(null); setUnverifyOpen(true); }}
                  className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800"
                >
                  {t('attest.unverify', 'Unverify')}
                </button>
              )}
              <button
                type="button"
                onClick={onFixAction}
                className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-slate-800"
              >
                {t('attest.openPrefix', 'Open')} {t(`fixModule.${item.fixModule}`, GBP_FIX_MODULE_LABEL[item.fixModule])}
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>

          {showEvidenceInput && showSelfAttestControls && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="url"
                value={evidenceUrl}
                onChange={(e) => setEvidenceUrl(e.target.value)}
                placeholder={t('attest.evidencePlaceholderShort', 'Optional evidence URL')}
                className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-500"
              />
              <button
                type="button"
                onClick={() => attestMut.mutate('SELF_ATTESTED')}
                disabled={attestMut.isPending}
                className="rounded bg-amber-500/20 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-500/30"
              >
                {t('attest.confirmSelfAttest', 'Confirm self-attest')}
              </button>
              <button
                type="button"
                onClick={() => { setShowEvidenceInput(false); setEvidenceUrl(''); }}
                className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
              >
                {t('attest.cancel', 'Cancel')}
              </button>
            </div>
          )}

          {error && <p className="mt-1 text-[10px] text-rose-300" role="alert">{error}</p>}
        </div>
      </div>

      <UnverifyDialog
        open={unverifyOpen}
        signalLabel={item.labelEn}
        busy={unverifyMut.isPending}
        errorText={unverifyMut.isError ? error : null}
        onCancel={() => setUnverifyOpen(false)}
        onConfirm={(reason) => unverifyMut.mutate(reason)}
      />
    </li>
  );
}
