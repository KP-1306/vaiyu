// web/src/components/partner/PartnerDetailDrawer.tsx
//
// Right-side drawer showing a single partner's full state. Sections:
//   1. Header with status + verification + kind badges + actions menu
//   2. Overview (contact, services, notes — read with Edit)
//   3. Verification panel (status switcher, notes, last verified stamp)
//   4. Commission ledger (AGENT only) — record + mark paid + cancel
//   5. Timeline of partner_events
//
// Actions:
//   - Edit (opens PartnerFormModal)
//   - Set status (PREFERRED / BACKUP / INACTIVE / DO_NOT_USE)
//   - Set verification (UNVERIFIED / PENDING / VERIFIED / REJECTED)
//   - Archive / Unarchive
//   - Record commission (AGENT only)
//   - Mark commission paid / Cancel commission

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowUpRight,
  CheckCircle2,
  Edit3,
  Loader2,
  Phone,
  Mail,
  ShieldCheck,
  Tag,
  X,
} from 'lucide-react';

import {
  archivePartner,
  cancelCommission,
  getPartner,
  listPartnerCommissions,
  listPartnerEvents,
  markCommissionPaid,
  recordPartnerCommission,
  setPartnerStatus,
  setPartnerVerification,
  unarchivePartner,
  PartnerServiceError,
} from '../../services/partnerService';
import type {
  Partner,
  PartnerStatus,
  PartnerVerificationStatus,
} from '../../types/partner';
import { PARTNER_VERIFICATION_STALE_DAYS } from '../../config/partnerNetwork';

import {
  PartnerCategoryBadge,
  PartnerKindBadge,
  PartnerStatusBadge,
  PartnerVerificationBadge,
} from './PartnerBadges';
import { PartnerLiabilityFooter } from './PartnerLiabilityFooter';
import { PartnerFormModal } from './PartnerFormModal';

interface Props {
  open: boolean;
  partnerId: string | null;
  onClose: () => void;
}

const STATUS_OPTIONS: { value: PartnerStatus; label: string; needsReason: boolean }[] = [
  { value: 'DRAFT',      label: 'Draft (hidden)',           needsReason: false },
  { value: 'VERIFIED',   label: 'Verified',                  needsReason: false },
  { value: 'PREFERRED',  label: 'Preferred',                 needsReason: false },
  { value: 'BACKUP',     label: 'Backup',                    needsReason: false },
  { value: 'INACTIVE',   label: 'Inactive',                  needsReason: false },
  { value: 'DO_NOT_USE', label: 'Do not use (reason req.)',  needsReason: true  },
];

const VERIFICATION_OPTIONS: PartnerVerificationStatus[] = [
  'UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED',
];

export function PartnerDetailDrawer({ open, partnerId, onClose }: Props) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const partnerQ = useQuery({
    queryKey: ['partner', partnerId],
    queryFn: () => getPartner(partnerId!),
    enabled: !!partnerId && open,
    staleTime: 5_000,
  });
  const commissionsQ = useQuery({
    queryKey: ['partner-commissions', partnerId],
    queryFn: () => listPartnerCommissions(partnerId!),
    enabled: !!partnerId && open && partnerQ.data?.kind === 'AGENT',
    staleTime: 5_000,
  });
  const eventsQ = useQuery({
    queryKey: ['partner-events', partnerId],
    queryFn: () => listPartnerEvents(partnerId!, 30),
    enabled: !!partnerId && open,
    staleTime: 5_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['partner', partnerId] });
    qc.invalidateQueries({ queryKey: ['partner-events', partnerId] });
    qc.invalidateQueries({ queryKey: ['partner-commissions', partnerId] });
    qc.invalidateQueries({ queryKey: ['partners'] });
  };

  const statusMut = useMutation({
    mutationFn: (vars: { status: PartnerStatus; reason?: string }) =>
      setPartnerStatus(partnerId!, vars.status, vars.reason),
    onSuccess: invalidate,
    onError: (e) => setActionError(e instanceof PartnerServiceError ? e.code : 'UNKNOWN_ERROR'),
  });
  const verificationMut = useMutation({
    mutationFn: (vars: { status: PartnerVerificationStatus; notes?: string }) =>
      setPartnerVerification(partnerId!, vars.status, vars.notes),
    onSuccess: invalidate,
    onError: (e) => setActionError(e instanceof PartnerServiceError ? e.code : 'UNKNOWN_ERROR'),
  });
  const archiveMut = useMutation({
    mutationFn: (reason?: string) =>
      partnerQ.data?.archived_at
        ? unarchivePartner(partnerId!)
        : archivePartner(partnerId!, reason),
    onSuccess: invalidate,
    onError: (e) => setActionError(e instanceof PartnerServiceError ? e.code : 'UNKNOWN_ERROR'),
  });

  if (!open) return null;

  const partner = partnerQ.data ?? null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Partner detail"
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col border-l border-slate-700 bg-[#0F1320] text-slate-100 shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-slate-800 px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">
              {partner?.partner_name ?? (partnerQ.isLoading ? 'Loading…' : 'Partner')}
            </h2>
            {partner && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <PartnerKindBadge kind={partner.kind} />
                <PartnerCategoryBadge category={partner.category} />
                <PartnerStatusBadge status={partner.status} />
                <PartnerVerificationBadge
                  status={partner.verification_status}
                  isStale={partner.is_verification_stale}
                />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!partner && partnerQ.isLoading && (
            <div className="flex h-40 items-center justify-center text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {!partner && !partnerQ.isLoading && (
            <div className="px-5 py-6 text-sm text-slate-400">
              Partner not found.
            </div>
          )}

          {partner && (
            <div className="space-y-6 px-5 py-4">
              {/* ── Actions row ─────────────────────────────────────── */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                  data-testid="partner-edit-button"
                >
                  <Edit3 className="h-3.5 w-3.5" aria-hidden /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => archiveMut.mutate(undefined)}
                  disabled={archiveMut.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  <Archive className="h-3.5 w-3.5" aria-hidden />
                  {partner.archived_at ? 'Unarchive' : 'Archive'}
                </button>
              </div>

              {/* ── Contact block ───────────────────────────────────── */}
              <Section title="Contact">
                <div className="space-y-1.5 text-sm">
                  {partner.contact_name && (
                    <div className="text-slate-200">{partner.contact_name}</div>
                  )}
                  {partner.contact_phone && (
                    <a
                      href={`tel:${partner.contact_phone}`}
                      className="flex items-center gap-2 text-emerald-300 hover:underline"
                    >
                      <Phone className="h-3.5 w-3.5" aria-hidden /> {partner.contact_phone}
                    </a>
                  )}
                  {partner.alternate_contact && (
                    <a
                      href={`tel:${partner.alternate_contact}`}
                      className="flex items-center gap-2 text-slate-300 hover:underline"
                    >
                      <Phone className="h-3.5 w-3.5" aria-hidden /> {partner.alternate_contact} (alt)
                    </a>
                  )}
                  {partner.email && (
                    <a
                      href={`mailto:${partner.email}`}
                      className="flex items-center gap-2 text-slate-300 hover:underline"
                    >
                      <Mail className="h-3.5 w-3.5" aria-hidden /> {partner.email}
                    </a>
                  )}
                  {!partner.contact_phone && !partner.email && (
                    <div className="text-slate-500">No contact on file.</div>
                  )}
                </div>
              </Section>

              {/* ── Services + meta ─────────────────────────────────── */}
              <Section title="Services & area">
                <dl className="space-y-1 text-sm text-slate-300">
                  <Row k="Service area" v={partner.service_area || '—'} />
                  <Row
                    k="Services"
                    v={partner.services_offered.length > 0 ? partner.services_offered.join(', ') : '—'}
                  />
                  <Row k="Preferred use" v={partner.preferred_use_case || '—'} />
                  <Row k="Price note" v={partner.price_note_text || '—'} />
                  <Row k="Emergency" v={partner.emergency_availability ? 'Yes' : 'No'} />
                  {partner.tags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 pt-1">
                      {partner.tags.map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-0.5 rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-300"
                        >
                          <Tag className="h-2.5 w-2.5" aria-hidden /> {t}
                        </span>
                      ))}
                    </div>
                  )}
                </dl>
              </Section>

              {/* ── Status switcher ─────────────────────────────────── */}
              <Section title="Status">
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={statusMut.isPending || partner.status === opt.value || !!partner.archived_at}
                      onClick={() => {
                        setActionError(null);
                        const reason = opt.needsReason
                          ? prompt('Why mark this partner as Do not use? (recorded in audit)')
                          : undefined;
                        if (opt.needsReason && (!reason || !reason.trim())) return;
                        statusMut.mutate({ status: opt.value, reason: reason ?? undefined });
                      }}
                      className={
                        partner.status === opt.value
                          ? 'rounded-md border border-emerald-500/50 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-200'
                          : 'rounded-md border border-slate-700 bg-slate-800/40 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50'
                      }
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </Section>

              {/* ── Verification ────────────────────────────────────── */}
              <Section title="Verification">
                <div className="flex flex-wrap items-center gap-1.5">
                  {VERIFICATION_OPTIONS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      disabled={verificationMut.isPending || partner.verification_status === v}
                      onClick={() => {
                        setActionError(null);
                        const notes =
                          v === 'REJECTED' || v === 'PENDING'
                            ? prompt('Add a verification note (optional).') ?? undefined
                            : undefined;
                        verificationMut.mutate({ status: v, notes });
                      }}
                      className={
                        partner.verification_status === v
                          ? 'rounded-full border border-emerald-500/50 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-200'
                          : 'rounded-full border border-slate-700 bg-slate-800/40 px-3 py-1 text-[11px] text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50'
                      }
                    >
                      {v.replace('_', ' ').toLowerCase()}
                    </button>
                  ))}
                </div>
                {partner.last_verified_at && (
                  <p className="mt-2 text-[11px] text-slate-400">
                    <ShieldCheck className="mr-1 inline h-3 w-3" aria-hidden />
                    Last verified {new Date(partner.last_verified_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {partner.is_verification_stale && (
                      <span className="ml-1 text-amber-300">
                        · stale (&gt;{PARTNER_VERIFICATION_STALE_DAYS} days — re-verify)
                      </span>
                    )}
                  </p>
                )}
                {partner.verification_notes && (
                  <p className="mt-1.5 whitespace-pre-line rounded-md border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 text-[11.5px] text-slate-300">
                    {partner.verification_notes}
                  </p>
                )}
              </Section>

              {/* ── Commission ledger (AGENT only) ──────────────────── */}
              {partner.kind === 'AGENT' && (
                <Section title="Commission ledger">
                  <CommissionLedger
                    partner={partner}
                    commissions={commissionsQ.data ?? []}
                    onChange={invalidate}
                  />
                </Section>
              )}

              {/* ── Notes ────────────────────────────────────────────── */}
              {partner.notes && (
                <Section title="Internal notes">
                  <p className="whitespace-pre-line text-sm text-slate-300">{partner.notes}</p>
                </Section>
              )}

              {/* ── Timeline ─────────────────────────────────────────── */}
              <Section title="Timeline">
                {eventsQ.isLoading && (
                  <div className="text-slate-500">Loading…</div>
                )}
                {eventsQ.data && eventsQ.data.length === 0 && (
                  <div className="text-slate-500">No events yet.</div>
                )}
                {eventsQ.data && eventsQ.data.length > 0 && (
                  <ul className="space-y-2 text-[11.5px]">
                    {eventsQ.data.map((ev) => (
                      <li key={ev.id} className="flex items-start gap-2 border-l-2 border-slate-700 pl-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-slate-300">{ev.event_type.replace(/_/g, ' ').toLowerCase()}</div>
                          <div className="text-[10.5px] text-slate-500">
                            {new Date(ev.occurred_at).toLocaleString('en-IN')}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {actionError && (
                <div role="alert" className="rounded-md border border-red-700/60 bg-red-900/20 px-3 py-2 text-xs text-red-200">
                  {actionError.replace(/_/g, ' ').toLowerCase()}
                </div>
              )}

              <PartnerLiabilityFooter compact />
            </div>
          )}
        </div>

        {editing && partner && (
          <PartnerFormModal
            open
            mode="edit"
            partner={partner}
            onClose={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              invalidate();
            }}
          />
        )}
      </aside>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-28 shrink-0 text-[11px] uppercase tracking-wide text-slate-500">{k}</dt>
      <dd className="flex-1 text-slate-200">{v}</dd>
    </div>
  );
}

// ─── Commission ledger sub-component ───────────────────────────────────────

function CommissionLedger({
  partner,
  commissions,
  onChange,
}: {
  partner: Partner;
  commissions: import('../../types/partner').PartnerCommission[];
  onChange: () => void;
}) {
  const [recordOpen, setRecordOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  const openRecord = () => {
    setAmount('');
    setNotes('');
    setError(null);
    setIdempotencyKey(crypto.randomUUID());
    setRecordOpen(true);
  };

  const submitRecord = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) { setError('INVALID_AMOUNT'); return; }
    setBusy(true);
    setError(null);
    try {
      await recordPartnerCommission({
        partnerId: partner.id,
        amountInr: n,
        notes,
        idempotencyKey,
      });
      setRecordOpen(false);
      onChange();
    } catch (e) {
      setError(e instanceof PartnerServiceError ? e.code : 'UNKNOWN_ERROR');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {commissions.length === 0 && (
        <div className="text-[11.5px] text-slate-500">No commissions recorded.</div>
      )}
      {commissions.length > 0 && (
        <ul className="divide-y divide-slate-800 rounded-md border border-slate-800">
          {commissions.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-100">
                  ₹{c.amount_inr.toLocaleString('en-IN')}
                  <span className={
                    c.status === 'PAID'      ? 'ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300'
                    : c.status === 'CANCELLED' ? 'ml-2 rounded-full bg-slate-600/30 px-2 py-0.5 text-[10px] text-slate-400'
                    : 'ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300'
                  }>
                    {c.status.toLowerCase()}
                  </span>
                </div>
                <div className="text-[10.5px] text-slate-500">
                  Accrued {new Date(c.accrued_at).toLocaleDateString('en-IN')}
                  {c.payout_reference && ` · ref ${c.payout_reference}`}
                </div>
                {c.notes && <div className="mt-0.5 text-[11px] text-slate-400">{c.notes}</div>}
              </div>
              {c.status === 'ACCRUED' && (
                <CommissionActions commissionId={c.id} onChange={onChange} />
              )}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={openRecord}
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[11.5px] font-medium text-emerald-200 hover:bg-emerald-500/20"
      >
        <ArrowUpRight className="h-3 w-3" aria-hidden /> Record commission
      </button>

      {recordOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-3">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-[#0F1320] p-4 text-slate-100">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold">Record commission</h4>
              <button onClick={() => setRecordOpen(false)} disabled={busy} aria-label="Close" className="text-slate-400 hover:text-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-400">Amount (INR) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={busy}
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
                  data-testid="commission-amount"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-slate-400">Notes</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={busy}
                  placeholder="e.g. booking ref ABC123 / 3 nights"
                  className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
                />
              </div>
              {error && (
                <div role="alert" className="rounded-md border border-red-700/60 bg-red-900/20 px-3 py-2 text-xs text-red-200">
                  {error.replace(/_/g, ' ').toLowerCase()}
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setRecordOpen(false)} disabled={busy} className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
                  Cancel
                </button>
                <button onClick={submitRecord} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/90 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                  {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                  Record
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CommissionActions({ commissionId, onChange }: { commissionId: string; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const handlePaid = async () => {
    const ref = prompt('Payout reference (UPI ref / bank ref / cheque no.) — required');
    if (!ref || !ref.trim()) return;
    const method = prompt('Payout method (UPI / BANK / CASH / CHEQUE)?') ?? '';
    setBusy(true);
    try {
      await markCommissionPaid({ id: commissionId, payoutReference: ref.trim(), payoutMethod: method.trim() || undefined });
      onChange();
    } catch { /* surfaced by parent */ }
    setBusy(false);
  };
  const handleCancel = async () => {
    const reason = prompt('Why cancel this commission? (recorded in audit)');
    if (!reason || !reason.trim()) return;
    setBusy(true);
    try {
      await cancelCommission(commissionId, reason.trim());
      onChange();
    } catch { /* surfaced */ }
    setBusy(false);
  };
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={handlePaid}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10.5px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
      >
        <CheckCircle2 className="h-3 w-3" aria-hidden /> Mark paid
      </button>
      <button
        onClick={handleCancel}
        disabled={busy}
        className="rounded-md border border-slate-700 px-2 py-1 text-[10.5px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
      >
        Cancel
      </button>
    </div>
  );
}
