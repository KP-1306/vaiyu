// web/src/routes/owner/LocalSeoPlanner.tsx
//
// /owner/:slug/seo-planner — Local SEO Landing Planner workspace.
//
// INTERNAL planning + governance only. The route lists blueprints, opens an
// inline editor, runs Policy-Shield feedback, and walks blueprints through the
// two-axis governance lifecycle. Nothing here publishes pages.

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Loader2,
  Pause,
  Play,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  LOCAL_SEO_LANDING_PLANNER_V0_ENABLED,
  SEO_CATEGORY_LABEL,
  SEO_CATEGORY_OPTIONS,
  SEO_REVIEW_LABEL,
  SEO_RISK_BLOCKS_APPROVAL,
  SEO_RISK_LABEL,
  SEO_STATUS_LABEL,
} from '../../config/localSeoPlanner';
import type {
  SeoBlueprint,
  SeoBlueprintCategory,
  SeoBlueprintRisk,
  SeoBlueprintStatus,
} from '../../types/seoBlueprint';
import {
  approveSeoBlueprint,
  archiveSeoBlueprint,
  createSeoBlueprint,
  getSeoBlueprint,
  holdSeoBlueprint,
  listSeoBlueprints,
  requestSeoBlueprintChanges,
  resumeSeoBlueprint,
  SeoBlueprintServiceError,
  softDeleteSeoBlueprint,
  submitSeoBlueprintForReview,
  updateSeoBlueprint,
} from '../../services/seoBlueprintService';
import { seoBlueprintQueryKeys } from '../../services/seoBlueprintQueryKeys';
import { useSeoBlueprintsRealtime } from '../../hooks/useSeoBlueprintsRealtime';
import { BlueprintForm } from '../../components/seo/BlueprintForm';
import {
  defaultProofFor,
  emptyDraft,
  type SeoBlueprintFormDraft,
} from '../../components/seo/BlueprintForm.validation';
import { BlueprintCard } from '../../components/seo/BlueprintCard';
import { PlannerEmptyState } from '../../components/seo/PlannerEmptyState';
import { PlannerDisclaimerBanner } from '../../components/seo/PlannerDisclaimerBanner';
import { RiskPill, StatusPill, ReviewPill } from '../../components/seo/SeoPills';
import { SeoBlueprintTimeline } from '../../components/seo/SeoBlueprintTimeline';
import { useOwnerT, type OwnerT } from '../../i18n/useOwnerT';

interface HotelRow { id: string; name: string; slug: string; city: string | null }
type Mode = { kind: 'list' } | { kind: 'new'; initial: SeoBlueprintFormDraft } | { kind: 'edit'; id: string };

export default function LocalSeoPlanner() {
  const { slug } = useParams<{ slug: string }>();
  const t = useOwnerT('owner-seo');
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [filterRisk, setFilterRisk] = useState<SeoBlueprintRisk | ''>('');
  const [filterStatus, setFilterStatus] = useState<SeoBlueprintStatus | ''>('');
  const [filterCategory, setFilterCategory] = useState<SeoBlueprintCategory | ''>('');

  // Resolve hotel
  const hotelQ = useQuery<HotelRow | null>({
    queryKey: ['seo-planner', 'hotel', slug],
    queryFn: async () => {
      if (!slug) return null;
      const { data, error } = await supabase
        .from('hotels')
        .select('id, name, slug, city')
        .eq('slug', slug)
        .maybeSingle();
      if (error) throw error;
      return data as HotelRow | null;
    },
    enabled: !!slug,
    staleTime: 60_000,
  });
  const hotel = hotelQ.data ?? null;
  const proofCtx = useMemo(() => ({ city: hotel?.city ?? null }), [hotel?.city]);
  useSeoBlueprintsRealtime(hotel?.id);

  const listQ = useQuery({
    queryKey: hotel?.id ? seoBlueprintQueryKeys.list(hotel.id) : ['seo-blueprints', 'noop'],
    queryFn: () =>
      hotel?.id
        ? listSeoBlueprints(hotel.id, {
            risks: filterRisk ? [filterRisk] : undefined,
            statuses: filterStatus ? [filterStatus] : undefined,
            categories: filterCategory ? [filterCategory] : undefined,
          })
        : Promise.resolve([] as SeoBlueprint[]),
    enabled: !!hotel?.id,
    staleTime: 15_000,
  });
  // Filter applied client-side too for instant feedback when category changes (server fetch debounced by query key).
  const filtered = useMemo(() => listQ.data ?? [], [listQ.data]);

  // ───── Mutations ─────────────────────────────────────────────────────────

  // Governance mutations all re-render the EditView, so invalidate the list,
  // the detail, AND the per-blueprint events query. Skipping any of these
  // leaves the UI stale even though the DB transition succeeded.
  const invalidateAfterGovernance = useCallback((id: string) => {
    qc.invalidateQueries({ queryKey: ['seo-blueprints', hotel?.id] });
    qc.invalidateQueries({ queryKey: seoBlueprintQueryKeys.detail(id) });
    qc.invalidateQueries({ queryKey: seoBlueprintQueryKeys.events(id) });
  }, [qc, hotel?.id]);

  const createM = useMutation({
    mutationFn: ({ draft }: { draft: SeoBlueprintFormDraft }) => {
      if (!hotel) throw new Error('hotel missing');
      return createSeoBlueprint({
        hotelId: hotel.id,
        pageTitleConcept: draft.pageTitleConcept,
        targetCategory: draft.targetCategory,
        requiredProof: draft.requiredProof,
        whyItMatters: nz(draft.whyItMatters),
        hinglishGuidance: nz(draft.hinglishGuidance),
        safeNextAction: nz(draft.safeNextAction),
        connectedModuleSuggestion: nz(draft.connectedModuleSuggestion),
        ownerNotes: nz(draft.ownerNotes),
        internalNotes: nz(draft.internalNotes),
      });
    },
    onSuccess: (out) => {
      qc.invalidateQueries({ queryKey: ['seo-blueprints', hotel?.id] });
      qc.invalidateQueries({ queryKey: seoBlueprintQueryKeys.events(out.id) });
      setMode({ kind: 'edit', id: out.id });
    },
    onError: (e) => setActionErr(humanizeErr(e, t)),
  });

  const updateM = useMutation({
    mutationFn: ({ id, draft, riskOverride, overrideReason }: {
      id: string;
      draft: SeoBlueprintFormDraft;
      riskOverride: SeoBlueprintRisk | null;
      overrideReason: string;
    }) =>
      updateSeoBlueprint({
        id,
        pageTitleConcept: draft.pageTitleConcept,
        targetCategory: draft.targetCategory,
        requiredProof: draft.requiredProof,
        whyItMatters: draft.whyItMatters,
        hinglishGuidance: draft.hinglishGuidance,
        safeNextAction: draft.safeNextAction,
        connectedModuleSuggestion: draft.connectedModuleSuggestion,
        ownerNotes: draft.ownerNotes,
        internalNotes: draft.internalNotes,
        riskOverride: riskOverride ?? undefined,
        overrideReason: overrideReason || undefined,
      }),
    onSuccess: (_out, vars) => invalidateAfterGovernance(vars.id),
    onError: (e) => setActionErr(humanizeErr(e, t)),
  });

  const submitM = useMutation({
    mutationFn: (id: string) => submitSeoBlueprintForReview(id),
    onSuccess: (_d, id) => invalidateAfterGovernance(id),
    onError: (e) => setActionErr(humanizeErr(e, t)),
  });

  const approveM = useMutation({
    mutationFn: (id: string) => approveSeoBlueprint(id),
    onSuccess: (_d, id) => invalidateAfterGovernance(id),
    onError: (e) => setActionErr(humanizeErr(e, t)),
  });

  const requestChangesM = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => requestSeoBlueprintChanges(id, note),
    onSuccess: (_d, vars) => invalidateAfterGovernance(vars.id),
    onError: (e) => setActionErr(humanizeErr(e, t)),
  });

  const holdM = useMutation({
    mutationFn: (id: string) => holdSeoBlueprint(id),
    onSuccess: (_d, id) => invalidateAfterGovernance(id),
    onError: (e) => setActionErr(humanizeErr(e, t)),
  });

  const resumeM = useMutation({
    mutationFn: (id: string) => resumeSeoBlueprint(id),
    onSuccess: (_d, id) => invalidateAfterGovernance(id),
    onError: (e) => setActionErr(humanizeErr(e, t)),
  });

  const archiveM = useMutation({
    mutationFn: (id: string) => archiveSeoBlueprint(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seo-blueprints', hotel?.id] });
      setMode({ kind: 'list' });
    },
    onError: (e) => setActionErr(humanizeErr(e, t)),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => softDeleteSeoBlueprint(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seo-blueprints', hotel?.id] });
      setMode({ kind: 'list' });
    },
    onError: (e) => setActionErr(humanizeErr(e, t)),
  });

  const startNew = useCallback((initialDraft?: SeoBlueprintFormDraft) => {
    setActionErr(null);
    setMode({ kind: 'new', initial: initialDraft ?? emptyDraft('GEOGRAPHIC_FOCUS', proofCtx) });
  }, [proofCtx]);

  if (!LOCAL_SEO_LANDING_PLANNER_V0_ENABLED) {
    return (
      <main className="vaiyu-owner min-h-screen grid place-items-center bg-[#0B0E14] text-slate-200">
        <p className="text-sm text-slate-400">{t('page.notEnabled', 'Local SEO Landing Planner is not enabled.')}</p>
      </main>
    );
  }
  if (hotelQ.isLoading) {
    return (
      <main className="vaiyu-owner min-h-screen grid place-items-center bg-[#0B0E14] text-slate-200">
        <Loader2 className="h-5 w-5 animate-spin text-slate-500" aria-hidden />
      </main>
    );
  }
  if (!hotel) {
    return (
      <main className="vaiyu-owner min-h-screen grid place-items-center bg-[#0B0E14] text-slate-200">
        <p className="text-sm text-slate-300">{t('page.hotelNotFound', 'Hotel not found.')}</p>
      </main>
    );
  }

  const blueprints = filtered;
  const isEmpty = listQ.isSuccess && blueprints.length === 0 && !filterRisk && !filterStatus && !filterCategory;

  return (
    <main className="vaiyu-owner min-h-screen bg-[#0B0E14] text-slate-200">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-5">
        <header className="space-y-4">
          <Link
            to={`/owner/${slug ?? ''}`}
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            {t('page.back', 'Back to dashboard')}
          </Link>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold text-slate-50">{t('page.title', 'Local SEO Landing Planner')}</h1>
              <p className="mt-1 text-sm text-slate-400 max-w-2xl">
                {t('page.subtitle', 'Plan + govern local page ideas. The Policy Shield flags which concepts are safe vs. spammy before any real page gets built. This tool publishes nothing.')}
              </p>
            </div>
            {mode.kind === 'list' && (
              <button
                type="button"
                onClick={() => startNew()}
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3.5 py-2 text-xs font-medium text-emerald-100 hover:bg-emerald-500/25"
                data-testid="seo-planner-new"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t('action.new', 'New blueprint')}
              </button>
            )}
          </div>
        </header>

        <PlannerDisclaimerBanner />

        {actionErr && (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200 inline-flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
            <span>{actionErr}</span>
            <button onClick={() => setActionErr(null)} className="ml-2 text-rose-300 hover:text-rose-100" aria-label={t('action.dismiss', 'Dismiss')}>
              <X className="h-3 w-3" aria-hidden />
            </button>
          </div>
        )}

        {/* List + filters */}
        {mode.kind === 'list' && (
          <>
            <section className="rounded-2xl border border-slate-800 bg-[#0F1320] p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="text-slate-500">{t('filter.risk', 'Risk')}</span>
                <select
                  value={filterRisk}
                  onChange={(e) => setFilterRisk((e.target.value || '') as SeoBlueprintRisk | '')}
                  className="rounded-md border border-slate-700 bg-[#0B0E14] px-2 py-1 text-xs text-slate-200 focus:border-emerald-400 focus:outline-none"
                >
                  <option value="">{t('filter.all', 'All')}</option>
                  {Object.entries(SEO_RISK_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>{t(`risk.${v}`, l)}</option>
                  ))}
                </select>

                <span className="text-slate-500 ml-2">{t('filter.status', 'Status')}</span>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus((e.target.value || '') as SeoBlueprintStatus | '')}
                  className="rounded-md border border-slate-700 bg-[#0B0E14] px-2 py-1 text-xs text-slate-200 focus:border-emerald-400 focus:outline-none"
                >
                  <option value="">{t('filter.all', 'All')}</option>
                  {Object.entries(SEO_STATUS_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>{t(`status.${v}`, l)}</option>
                  ))}
                </select>

                <span className="text-slate-500 ml-2">{t('filter.category', 'Category')}</span>
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory((e.target.value || '') as SeoBlueprintCategory | '')}
                  className="rounded-md border border-slate-700 bg-[#0B0E14] px-2 py-1 text-xs text-slate-200 focus:border-emerald-400 focus:outline-none"
                >
                  <option value="">{t('filter.all', 'All')}</option>
                  {SEO_CATEGORY_OPTIONS.map((c) => (
                    <option key={c} value={c}>{t(`category.${c}`, SEO_CATEGORY_LABEL[c])}</option>
                  ))}
                </select>
              </div>
            </section>

            {listQ.isLoading ? (
              <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-8 text-center">
                <Loader2 className="h-4 w-4 animate-spin text-slate-500 mx-auto" aria-hidden />
              </div>
            ) : isEmpty ? (
              <PlannerEmptyState
                onCreateBlank={() => startNew()}
                onPickStarter={(idea) =>
                  startNew({
                    ...emptyDraft(idea.category, proofCtx),
                    pageTitleConcept: idea.title,
                    requiredProof: defaultProofFor(idea.category, proofCtx),
                  })
                }
              />
            ) : blueprints.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-700 bg-[#0F1320] p-6 text-center">
                <p className="text-sm text-slate-300">{t('list.noMatch', 'No blueprints match these filters.')}</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {blueprints.map((b) => (
                  <BlueprintCard
                    key={b.id}
                    blueprint={b}
                    onOpen={() => setMode({ kind: 'edit', id: b.id })}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {mode.kind === 'new' && (
          <section className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-100">{t('list.newSection', 'New blueprint')}</h2>
              <button
                type="button"
                onClick={() => setMode({ kind: 'list' })}
                className="text-[11px] text-slate-400 hover:text-slate-200"
              >
                {t('action.cancel', 'Cancel')}
              </button>
            </div>
            <BlueprintForm
              initial={mode.initial}
              proofContext={proofCtx}
              busy={createM.isPending}
              submitLabel={t('action.createBlueprint', 'Create blueprint')}
              onSubmit={({ draft }) => createM.mutate({ draft })}
              onCancel={() => setMode({ kind: 'list' })}
            />
          </section>
        )}

        {mode.kind === 'edit' && (
          <EditView
            blueprintId={mode.id}
            proofContext={proofCtx}
            onClose={() => setMode({ kind: 'list' })}
            onUpdate={(payload) => updateM.mutate({ id: mode.id, ...payload })}
            onSubmitForReview={() => submitM.mutate(mode.id)}
            onApprove={() => approveM.mutate(mode.id)}
            onRequestChanges={(note) => requestChangesM.mutate({ id: mode.id, note })}
            onHold={() => holdM.mutate(mode.id)}
            onResume={() => resumeM.mutate(mode.id)}
            onArchive={() => {
              if (window.confirm(t('confirm.archive', 'Archive this blueprint?'))) archiveM.mutate(mode.id);
            }}
            onDelete={() => {
              if (window.confirm(t('confirm.delete', 'Delete this blueprint? (soft-delete; audit preserved)'))) deleteM.mutate(mode.id);
            }}
            busy={updateM.isPending || submitM.isPending || approveM.isPending || requestChangesM.isPending || holdM.isPending || resumeM.isPending || archiveM.isPending || deleteM.isPending}
          />
        )}
      </div>
    </main>
  );
}

// ─── Inline edit view ────────────────────────────────────────────────────────

function EditView(props: {
  blueprintId: string;
  proofContext: { city: string | null };
  busy: boolean;
  onClose: () => void;
  onUpdate: (payload: {
    draft: SeoBlueprintFormDraft;
    riskOverride: SeoBlueprintRisk | null;
    overrideReason: string;
  }) => void;
  onSubmitForReview: () => void;
  onApprove: () => void;
  onRequestChanges: (note: string) => void;
  onHold: () => void;
  onResume: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const t = useOwnerT('owner-seo');
  const blueprintQ = useQuery({
    queryKey: seoBlueprintQueryKeys.detail(props.blueprintId),
    queryFn: () => getSeoBlueprint(props.blueprintId),
    staleTime: 5_000,
  });
  const bp = blueprintQ.data;

  if (blueprintQ.isLoading) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-8 text-center">
        <Loader2 className="h-4 w-4 animate-spin text-slate-500 mx-auto" aria-hidden />
      </div>
    );
  }
  if (!bp) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-6 text-center text-sm text-slate-300">
        {t('edit.notFound', 'Blueprint not found.')}
      </div>
    );
  }

  const editable = bp.status === 'DRAFT' || bp.status === 'IN_REVIEW' || bp.status === 'ON_HOLD';
  const approvalBlocked = SEO_RISK_BLOCKS_APPROVAL.includes(bp.risk_classification);
  const initialDraft: SeoBlueprintFormDraft = {
    pageTitleConcept: bp.page_title_concept,
    targetCategory: bp.target_category,
    requiredProof: bp.required_proof.map((p) => ({ ...p })),
    whyItMatters: bp.why_it_matters ?? '',
    hinglishGuidance: bp.hinglish_guidance ?? '',
    safeNextAction: bp.safe_next_action ?? '',
    connectedModuleSuggestion: bp.connected_module_suggestion ?? '',
    ownerNotes: bp.owner_notes ?? '',
    internalNotes: bp.internal_notes ?? '',
  };

  return (
    <section className="space-y-4">
      <header className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">{t(`category.${bp.target_category}`, SEO_CATEGORY_LABEL[bp.target_category])}</p>
            <h2 className="text-base font-semibold text-slate-100 truncate">{bp.page_title_concept}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <RiskPill risk={bp.risk_classification} />
              <StatusPill status={bp.status} />
              <ReviewPill status={bp.review_status as never} />
              <span className="text-[10px] text-slate-500">{t('edit.updated', 'Updated {{when}}', { when: new Date(bp.updated_at).toLocaleString('en-IN') })}</span>
            </div>
            {bp.review_notes && (
              <p className="mt-2 text-[11px] italic text-slate-400">
                <span className="text-slate-500">{t('edit.reviewNote', 'Review note: ')}</span>{bp.review_notes}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="text-[11px] text-slate-400 hover:text-slate-200"
            aria-label={t('edit.backToList', 'Back to list')}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Lifecycle action bar */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {bp.status === 'DRAFT' && (
            <button
              type="button"
              onClick={props.onSubmitForReview}
              disabled={props.busy}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
              data-testid="blueprint-submit-for-review"
            >
              <Send className="h-3 w-3" aria-hidden />
              {t('action.submitForReview', 'Submit for review')}
            </button>
          )}
          {bp.status === 'IN_REVIEW' && (
            <>
              <button
                type="button"
                onClick={props.onApprove}
                disabled={props.busy || approvalBlocked}
                title={approvalBlocked ? t('edit.cannotApprove', 'Cannot approve while risk = {{risk}}', { risk: t(`risk.${bp.risk_classification}`, SEO_RISK_LABEL[bp.risk_classification]) }) : undefined}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/50 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="blueprint-approve"
              >
                <CheckCircle2 className="h-3 w-3" aria-hidden />
                {t('action.approveReady', 'Approve & mark ready')}
              </button>
              <button
                type="button"
                onClick={() => {
                  const note = window.prompt(t('confirm.requestChangesReason', 'Reason for requesting changes?'));
                  if (note && note.trim()) props.onRequestChanges(note.trim());
                }}
                disabled={props.busy}
                className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                data-testid="blueprint-request-changes"
              >
                {t('action.requestChanges', 'Request changes')}
              </button>
            </>
          )}
          {(bp.status === 'DRAFT' || bp.status === 'IN_REVIEW' || bp.status === 'READY_TO_BUILD') && (
            <button
              type="button"
              onClick={props.onHold}
              disabled={props.busy}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              <Pause className="h-3 w-3" aria-hidden />
              {t('action.hold', 'Hold')}
            </button>
          )}
          {bp.status === 'ON_HOLD' && (
            <button
              type="button"
              onClick={props.onResume}
              disabled={props.busy}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
            >
              <Play className="h-3 w-3" aria-hidden />
              {t('action.resume', 'Resume')}
            </button>
          )}
          {bp.status !== 'ARCHIVED' && (
            <button
              type="button"
              onClick={props.onArchive}
              disabled={props.busy}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              {t('action.archive', 'Archive')}
            </button>
          )}
          <button
            type="button"
            onClick={props.onDelete}
            disabled={props.busy}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/5 px-2.5 py-1 text-[11px] text-rose-200 hover:bg-rose-500/15 disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" aria-hidden />
            {t('action.delete', 'Delete')}
          </button>
        </div>

        {bp.status === 'READY_TO_BUILD' && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-200 inline-flex items-start gap-2">
            <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
            <span>
              {t('edit.readyNote', 'Approved + ready to build. (Phase 2 = a planner-gated publisher; not built yet — this stays an internal signal until then.)')}
            </span>
          </div>
        )}
      </header>

      {editable ? (
        <BlueprintForm
          initial={initialDraft}
          allowOverride
          proofContext={props.proofContext}
          busy={props.busy}
          submitLabel={t('action.saveChanges', 'Save changes')}
          onSubmit={(payload) => props.onUpdate(payload)}
          onCancel={props.onClose}
        />
      ) : (
        <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 text-xs text-slate-400">
          {t('edit.notEditable', 'This blueprint is {{status}}. ', { status: t(`status.${bp.status}`, SEO_STATUS_LABEL[bp.status]).toLowerCase() })}
          {bp.status === 'READY_TO_BUILD' ? t('edit.putOnHold', 'Put it on hold to edit.') : t('edit.editNotAllowed', 'Editing not allowed in this state.')}
        </div>
      )}

      <SeoBlueprintTimeline blueprintId={props.blueprintId} />
    </section>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function nz(s: string | undefined | null): string | undefined {
  if (s == null) return undefined;
  const t = s.trim();
  return t ? t : undefined;
}

function humanizeErr(e: unknown, t: OwnerT): string {
  if (e instanceof SeoBlueprintServiceError) {
    switch (e.code) {
      case 'NOT_AUTHORIZED': return t('errors.NOT_AUTHORIZED', "You don't have permission for that action.");
      case 'BLUEPRINT_NOT_FOUND': return t('errors.BLUEPRINT_NOT_FOUND', 'Blueprint not found.');
      case 'BLUEPRINT_DELETED': return t('errors.BLUEPRINT_DELETED', 'Blueprint has been deleted.');
      case 'NOT_EDITABLE': return t('errors.NOT_EDITABLE', "This blueprint isn't editable in its current state. Hold it first.");
      case 'INVALID_TRANSITION': return t('errors.INVALID_TRANSITION', "That lifecycle change isn't allowed from this state.");
      case 'NOTE_REQUIRED': return t('errors.NOTE_REQUIRED', 'A note is required when requesting changes.');
      case 'TITLE_REQUIRED': return t('errors.TITLE_REQUIRED', 'Page-title concept is required.');
      case 'OVERRIDE_REASON_REQUIRED': return t('errors.OVERRIDE_REASON_REQUIRED', 'When overriding the risk flag, a reason is required.');
      case 'RISK_BLOCKS_APPROVAL':
        return t('errors.RISK_BLOCKS_APPROVAL', "Can't approve while the Policy Shield flags this blueprint as unsafe (risky / fake / duplicate). Fix the concept or override with a reason first.");
      default: return e.message;
    }
  }
  return (e as Error).message ?? t('errors.actionFailed', 'Action failed');
}
