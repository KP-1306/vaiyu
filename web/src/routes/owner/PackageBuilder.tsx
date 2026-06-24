// web/src/routes/owner/PackageBuilder.tsx
//
// /owner/:slug/packages/new          — create flow
// /owner/:slug/packages/:packageId   — edit flow
//
// Same form component; behaviour switches on the presence of :packageId.

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  Check,
  Copy,
  Loader2,
  Pause,
  Play,
  Send,
  Trash2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  PACKAGE_BUILDER_V0_ENABLED,
} from '../../config/packages';
import {
  archivePackage,
  approvePackage,
  createPackage,
  duplicatePackage,
  getPackage,
  pausePackage,
  publishPackage,
  PackageServiceError,
  requestPackageChanges,
  resumePackage,
  softDeletePackage,
  submitPackageForApproval,
  updatePackage,
  type CreatePackageInput,
} from '../../services/packageService';
import { packageQueryKeys } from '../../services/packageQueryKeys';
import { PackageBuilderForm } from '../../components/packages/PackageBuilderForm';
import {
  emptyDraft,
  type PackageFormDraft,
} from '../../components/packages/PackageBuilderForm.validation';
import { PackageDisclaimerBanner } from '../../components/packages/PackageDisclaimerBanner';
import {
  PackageApprovalPill,
  PackageStatusPill,
} from '../../components/packages/PackageStatusPill';
import { track } from '../../lib/analytics';
import type { Package } from '../../types/package';
import { useOwnerT, type OwnerT } from '../../i18n/useOwnerT';

interface HotelRow { id: string; name: string; slug: string }

function packageToDraft(p: Package): PackageFormDraft {
  return {
    name: p.name,
    slug: p.slug,
    category: p.category,
    targetGuestType: p.target_guest_type ?? '',
    heroImageUrl: p.hero_image_url ?? '',
    shortPitch: p.short_pitch ?? '',
    longDescription: p.long_description ?? '',
    durationNights: p.duration_nights,
    minPartyAdults: p.min_party_adults,
    maxPartyAdults: p.max_party_adults,
    roomTypeId: p.room_type_id,
    seasonMonths: p.season_months,
    validFrom: p.valid_from ?? '',
    validUntil: p.valid_until ?? '',
    foodInclusions: p.food_inclusions,
    activityInclusions: p.activity_inclusions,
    transferInclusions: p.transfer_inclusions,
    customInclusions: p.custom_inclusions,
    basePriceRupees: p.base_price_paise != null ? p.base_price_paise / 100 : null,
    basePriceBasis: p.base_price_basis,
    startingPriceText: p.starting_price_text,
    enquiryCtaLabel: p.enquiry_cta_label,
    internalNotes: p.internal_notes ?? '',
  };
}

function draftToCreate(hotelId: string, d: PackageFormDraft): CreatePackageInput {
  return {
    hotelId,
    name: d.name.trim(),
    slug: d.slug.trim().toLowerCase(),
    category: d.category,
    durationNights: d.durationNights,
    startingPriceText: d.startingPriceText.trim(),
    shortPitch: d.shortPitch.trim() || undefined,
    longDescription: d.longDescription.trim() || undefined,
    targetGuestType: d.targetGuestType.trim() || undefined,
    heroImageUrl: d.heroImageUrl.trim() || undefined,
    minPartyAdults: d.minPartyAdults,
    maxPartyAdults: d.maxPartyAdults ?? undefined,
    roomTypeId: d.roomTypeId,
    seasonMonths: d.seasonMonths,
    validFrom: d.validFrom || undefined,
    validUntil: d.validUntil || undefined,
    foodInclusions: d.foodInclusions,
    activityInclusions: d.activityInclusions,
    transferInclusions: d.transferInclusions,
    customInclusions: d.customInclusions,
    basePricePaise: d.basePriceRupees != null ? Math.round(d.basePriceRupees * 100) : null,
    basePriceBasis: d.basePriceBasis,
    enquiryCtaLabel: d.enquiryCtaLabel.trim(),
    internalNotes: d.internalNotes.trim() || undefined,
  };
}

export default function PackageBuilder() {
  const { slug, id: packageId } = useParams<{ slug: string; id?: string }>();
  const navigate = useNavigate();
  const t = useOwnerT('owner-packages');
  const qc = useQueryClient();
  const [actionErr, setActionErr] = useState<string | null>(null);
  const isEdit = !!packageId;

  const hotelQ = useQuery<HotelRow | null>({
    queryKey: ['packages', 'hotel', slug],
    queryFn: async () => {
      if (!slug) return null;
      const { data, error } = await supabase
        .from('hotels')
        .select('id, name, slug')
        .eq('slug', slug)
        .maybeSingle();
      if (error) throw error;
      return data as HotelRow | null;
    },
    enabled: !!slug,
    staleTime: 60_000,
  });
  const hotel = hotelQ.data ?? null;

  const packageQ = useQuery({
    queryKey: packageId ? packageQueryKeys.detail(packageId) : ['package', 'noop'],
    queryFn: () => (packageId ? getPackage(packageId) : Promise.resolve(null)),
    enabled: isEdit,
    staleTime: 15_000,
  });

  const createM = useMutation({
    mutationFn: (draft: PackageFormDraft) => {
      if (!hotel) throw new Error('hotel missing');
      return createPackage(draftToCreate(hotel.id, draft));
    },
    onSuccess: (out) => {
      track('package_created', { id: out.id });
      qc.invalidateQueries({ queryKey: ['packages', hotel?.id] });
      navigate(`/owner/${slug}/packages/${out.id}`, { replace: true });
    },
    onError: (e) => setActionErr(humanizeErr(e, t)),
  });

  const updateM = useMutation({
    mutationFn: (draft: PackageFormDraft) => {
      if (!packageId) throw new Error('package id missing');
      return updatePackage({
        id: packageId,
        name: draft.name,
        category: draft.category,
        targetGuestType: draft.targetGuestType || undefined,
        heroImageUrl: draft.heroImageUrl || undefined,
        clearHeroImage: draft.heroImageUrl === '' && (packageQ.data?.hero_image_url ?? null) !== null,
        shortPitch: draft.shortPitch,
        longDescription: draft.longDescription,
        durationNights: draft.durationNights,
        minPartyAdults: draft.minPartyAdults,
        maxPartyAdults: draft.maxPartyAdults ?? undefined,
        seasonMonths: draft.seasonMonths,
        validFrom: draft.validFrom || undefined,
        validUntil: draft.validUntil || undefined,
        foodInclusions: draft.foodInclusions,
        activityInclusions: draft.activityInclusions,
        transferInclusions: draft.transferInclusions,
        customInclusions: draft.customInclusions,
        basePricePaise: draft.basePriceRupees != null ? Math.round(draft.basePriceRupees * 100) : undefined,
        basePriceBasis: draft.basePriceBasis,
        startingPriceText: draft.startingPriceText,
        enquiryCtaLabel: draft.enquiryCtaLabel,
        internalNotes: draft.internalNotes,
      });
    },
    onSuccess: () => {
      track('package_edited', { id: packageId });
      qc.invalidateQueries({ queryKey: packageQueryKeys.detail(packageId!) });
      qc.invalidateQueries({ queryKey: ['packages', hotel?.id] });
    },
    onError: (e) => setActionErr(humanizeErr(e, t)),
  });

  const submitM = useMutation({
    mutationFn: () => submitPackageForApproval(packageId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: packageQueryKeys.detail(packageId!) });
      qc.invalidateQueries({ queryKey: ['packages', hotel?.id] });
    },
    onError: (e) => setActionErr(humanizeErr(e, t)),
  });

  const approveM = useMutation({
    mutationFn: () => approvePackage(packageId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: packageQueryKeys.detail(packageId!) });
      qc.invalidateQueries({ queryKey: ['packages', hotel?.id] });
    },
    onError: (e) => setActionErr(humanizeErr(e, t)),
  });

  const requestChangesM = useMutation({
    mutationFn: (note: string) => requestPackageChanges(packageId!, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: packageQueryKeys.detail(packageId!) });
      qc.invalidateQueries({ queryKey: ['packages', hotel?.id] });
    },
    onError: (e) => setActionErr(humanizeErr(e, t)),
  });

  const publishM = useMutation({
    mutationFn: () => publishPackage(packageId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: packageQueryKeys.detail(packageId!) });
      qc.invalidateQueries({ queryKey: ['packages', hotel?.id] });
    },
    onError: (e) => setActionErr(humanizeErr(e, t)),
  });

  const pauseM = useMutation({
    mutationFn: () => pausePackage(packageId!),
    onSuccess: () => qc.invalidateQueries({ queryKey: packageQueryKeys.detail(packageId!) }),
    onError: (e) => setActionErr(humanizeErr(e, t)),
  });

  const resumeM = useMutation({
    mutationFn: () => resumePackage(packageId!),
    onSuccess: () => qc.invalidateQueries({ queryKey: packageQueryKeys.detail(packageId!) }),
    onError: (e) => setActionErr(humanizeErr(e, t)),
  });

  const archiveM = useMutation({
    mutationFn: () => archivePackage(packageId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['packages', hotel?.id] });
      navigate(`/owner/${slug}/packages`);
    },
    onError: (e) => setActionErr(humanizeErr(e, t)),
  });

  const duplicateM = useMutation({
    mutationFn: async () => {
      if (!packageQ.data) throw new Error('package missing');
      return duplicatePackage(
        packageQ.data.id,
        `${packageQ.data.name} (copy)`,
        `${packageQ.data.slug}-copy-${Date.now().toString(36).slice(-4)}`,
      );
    },
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ['packages', hotel?.id] });
      navigate(`/owner/${slug}/packages/${newId}`);
    },
    onError: (e) => setActionErr(humanizeErr(e, t)),
  });

  const deleteM = useMutation({
    mutationFn: () => softDeletePackage(packageId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['packages', hotel?.id] });
      navigate(`/owner/${slug}/packages`);
    },
    onError: (e) => setActionErr(humanizeErr(e, t)),
  });

  const handleCreate = useCallback((draft: PackageFormDraft) => {
    setActionErr(null);
    createM.mutate(draft);
  }, [createM]);

  const handleUpdate = useCallback((draft: PackageFormDraft) => {
    setActionErr(null);
    updateM.mutate(draft);
  }, [updateM]);

  if (!PACKAGE_BUILDER_V0_ENABLED) {
    return <main className="vaiyu-owner min-h-screen grid place-items-center bg-[#0B0E14] text-slate-200">{t('builder.disabled', 'Disabled.')}</main>;
  }
  if (hotelQ.isLoading || (isEdit && packageQ.isLoading)) {
    return (
      <main className="vaiyu-owner min-h-screen grid place-items-center bg-[#0B0E14] text-slate-200">
        <Loader2 className="h-5 w-5 animate-spin text-slate-500" aria-hidden />
      </main>
    );
  }
  if (!hotel) {
    return <main className="vaiyu-owner min-h-screen grid place-items-center bg-[#0B0E14] text-slate-200"><p className="text-sm">{t('builder.hotelNotFound', 'Hotel not found.')}</p></main>;
  }
  if (isEdit && !packageQ.data) {
    return <main className="vaiyu-owner min-h-screen grid place-items-center bg-[#0B0E14] text-slate-200"><p className="text-sm">{t('builder.packageNotFound', 'Package not found.')}</p></main>;
  }

  const pkg = packageQ.data ?? null;
  const initial = pkg ? packageToDraft(pkg) : emptyDraft();
  const editing = pkg?.status === 'DRAFT' || pkg?.status === 'READY' || pkg?.status === 'PAUSED';

  function copyPublicUrl() {
    if (!pkg || !hotel) return;
    const url = `${window.location.origin}/p/${hotel.slug}/package/${pkg.slug}`;
    void navigator.clipboard?.writeText(url);
  }

  return (
    <main className="vaiyu-owner min-h-screen bg-[#0B0E14] text-slate-200">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-5">
        <header className="space-y-3">
          <Link
            to={`/owner/${slug}/packages`}
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            {t('builder.back', 'Back to packages')}
          </Link>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold text-slate-50">
                {isEdit ? pkg!.name : t('builder.newTitle', 'New package')}
              </h1>
              {pkg && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <PackageStatusPill status={pkg.status} />
                  <PackageApprovalPill status={pkg.owner_approval_status} />
                  <span className="text-[10px] text-slate-500">
                    {t('builder.updated', 'Updated {{at}}', { at: new Date(pkg.updated_at).toLocaleString('en-IN') })}
                  </span>
                </div>
              )}
            </div>
            {pkg && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Link
                  to={`/owner/${slug}/packages/${pkg.id}/preview`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                >
                  {t('builder.preview', 'Preview')}
                </Link>
                {pkg.status === 'ACTIVE' && pkg.owner_approval_status === 'APPROVED' && (
                  <button
                    type="button"
                    onClick={copyPublicUrl}
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20"
                    data-testid="package-copy-url"
                  >
                    <Copy className="h-3 w-3" aria-hidden />
                    {t('builder.copyUrl', 'Copy public URL')}
                  </button>
                )}
                {pkg.status === 'ACTIVE' && (
                  <Link
                    to={`/p/${hotel.slug}/package/${pkg.slug}`}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20"
                  >
                    {t('builder.open', 'Open')} <ArrowUpRight className="h-3 w-3" aria-hidden />
                  </Link>
                )}
              </div>
            )}
          </div>
        </header>

        <PackageDisclaimerBanner />

        {/* Approval / lifecycle action bar */}
        {pkg && (
          <section className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3">
            <h2 className="text-sm font-semibold text-slate-100">{t('builder.lifecycle', 'Lifecycle')}</h2>
            {pkg.approval_notes && (
              <p className="text-[11px] text-slate-400 italic">
                {t('builder.approvalNote', 'Approval note: {{note}}', { note: pkg.approval_notes })}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {pkg.status === 'DRAFT' && (
                <button
                  type="button"
                  onClick={() => submitM.mutate()}
                  disabled={submitM.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20"
                  data-testid="package-submit-for-approval"
                >
                  <Send className="h-3 w-3" aria-hidden />
                  {t('builder.submit', 'Submit for approval')}
                </button>
              )}
              {pkg.status === 'READY' && (
                <>
                  <button
                    type="button"
                    onClick={() => approveM.mutate()}
                    disabled={approveM.isPending}
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20"
                    data-testid="package-approve"
                  >
                    <Check className="h-3 w-3" aria-hidden />
                    {t('builder.approve', 'Approve')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const note = window.prompt(t('builder.requestChangesPrompt', 'Reason for requesting changes?'));
                      if (note && note.trim()) requestChangesM.mutate(note.trim());
                    }}
                    disabled={requestChangesM.isPending}
                    className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/20"
                    data-testid="package-request-changes"
                  >
                    {t('builder.requestChanges', 'Request changes')}
                  </button>
                  {pkg.owner_approval_status === 'APPROVED' && (
                    <button
                      type="button"
                      onClick={() => publishM.mutate()}
                      disabled={publishM.isPending}
                      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-500/25"
                      data-testid="package-publish"
                    >
                      <Send className="h-3 w-3" aria-hidden />
                      {t('builder.publish', 'Publish (go live)')}
                    </button>
                  )}
                </>
              )}
              {pkg.status === 'ACTIVE' && (
                <button
                  type="button"
                  onClick={() => pauseM.mutate()}
                  disabled={pauseM.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-500/20"
                  data-testid="package-pause"
                >
                  <Pause className="h-3 w-3" aria-hidden />
                  {t('builder.pause', 'Pause')}
                </button>
              )}
              {pkg.status === 'PAUSED' && pkg.owner_approval_status === 'APPROVED' && (
                <button
                  type="button"
                  onClick={() => resumeM.mutate()}
                  disabled={resumeM.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20"
                  data-testid="package-resume"
                >
                  <Play className="h-3 w-3" aria-hidden />
                  {t('builder.resume', 'Resume')}
                </button>
              )}
              <button
                type="button"
                onClick={() => duplicateM.mutate()}
                disabled={duplicateM.isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
              >
                <Copy className="h-3 w-3" aria-hidden />
                {t('builder.duplicate', 'Duplicate')}
              </button>
              {pkg.status !== 'ARCHIVED' && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(t('builder.archiveConfirm', 'Archive this package? It will hide from public + workspace but stay in audit.')))
                      archiveM.mutate();
                  }}
                  disabled={archiveM.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
                >
                  {t('builder.archive', 'Archive')}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t('builder.deleteConfirm', 'Delete this package? Soft-delete; audit preserved.')))
                    deleteM.mutate();
                }}
                disabled={deleteM.isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/15"
              >
                <Trash2 className="h-3 w-3" aria-hidden />
                {t('builder.delete', 'Delete')}
              </button>
            </div>
            {actionErr && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-200 inline-flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
                <span>{actionErr}</span>
              </div>
            )}
          </section>
        )}

        {/* Form */}
        {(!pkg || editing) ? (
          <PackageBuilderForm
            initial={initial}
            lockSlug={isEdit}
            busy={createM.isPending || updateM.isPending}
            submitLabel={isEdit ? t('builder.saveChanges', 'Save changes') : t('builder.createDraft', 'Create draft')}
            onSubmit={isEdit ? handleUpdate : handleCreate}
            onCancel={() => navigate(`/owner/${slug}/packages`)}
          />
        ) : (
          <div className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 text-xs text-slate-400">
            {t('builder.blocked', "This package is {{status}} and can't be edited here. Pause or archive to edit, or duplicate to create a new draft.", { status: t(`status.${pkg.status}`, pkg.status) })}
          </div>
        )}
      </div>
    </main>
  );
}

function humanizeErr(e: unknown, t?: OwnerT): string {
  const tr = (key: string, en: string) => (t ? t(key, en) : en);
  if (e instanceof PackageServiceError) {
    switch (e.code) {
      case 'SLUG_TAKEN': return tr('actionError.SLUG_TAKEN', 'That URL slug is already in use for this hotel.');
      case 'NOT_AUTHORIZED': return tr('actionError.NOT_AUTHORIZED', 'You don\'t have permission for that action.');
      case 'APPROVAL_REQUIRED': return tr('actionError.APPROVAL_REQUIRED', 'A manager must approve the package before it can go live.');
      case 'NOTE_REQUIRED': return tr('actionError.NOTE_REQUIRED', 'A note is required when requesting changes.');
      case 'INVALID_TRANSITION': return tr('actionError.INVALID_TRANSITION', 'That status change isn\'t allowed from the current state.');
      case 'NOT_EDITABLE': return tr('actionError.NOT_EDITABLE', 'This package is in a state where edits are blocked.');
      case 'ROOM_TYPE_MISMATCH': return tr('actionError.ROOM_TYPE_MISMATCH', 'The selected room type doesn\'t belong to this hotel.');
      default: return e.message;
    }
  }
  return (e as Error).message ?? tr('actionError.FALLBACK', 'Action failed');
}
