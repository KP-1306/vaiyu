// web/src/components/visibility/GoogleBusinessChecklist.tsx
//
// Expanded GBP Checklist surface — 7 categories × 30 items grouped into
// collapsible sections.
//
// Item sources:
//   • LINKED_VISIBILITY (9 items) → render VisibilitySignalRow using the
//     existing Visibility attestation infrastructure (single source of truth
//     for the 9 items that overlap between Visibility GMB_READINESS and GBP).
//   • SELF_ATTESTED (19 items) → render GBPChecklistRow using the GBP
//     attestations table (set_gbp_attestation RPC).
//   • AUTO_DERIVED (2 items: description_present, amenities_visible_on_gbp)
//     → render GBPChecklistRow read-only with derived satisfaction from
//     hotel.description (≥30 chars) and hotel.amenities[] (≥3 entries).
//
// Toggle:
//   GOOGLE_BUSINESS_CHECKLIST_V0_ENABLED = false reverts to the prior 6-item
//   GMB_READINESS-only panel (legacy behaviour preserved for rollback).

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Globe, Loader2 } from 'lucide-react';

import {
  GBP_CATALOG,
  GBP_CATEGORY_LABEL,
  GBP_CATEGORY_ORDER,
  GBP_DISCLAIMER_EN,
  GBP_DISCLAIMER_HI,
  GBP_READY_THRESHOLD_PCT,
  GOOGLE_BUSINESS_CHECKLIST_V0_ENABLED,
  meetsGBPReadyThreshold,
} from '../../config/gbpChecklist';
import { useOwnerT, useOwnerLang, type OwnerT } from '../../i18n/useOwnerT';
import { gbpChecklistQueryKeys } from '../../services/gbpChecklistQueryKeys';
import { listGBPAttestations } from '../../services/gbpChecklistService';
import { VISIBILITY_CATEGORY_WEIGHT } from '../../config/visibilityScore';
import { VisibilitySignalRow } from './VisibilitySignalRow';
import { GBPChecklistRow } from './GBPChecklistRow';

import type {
  GBPAttestationRow,
  GBPAttestationState,
  GBPCatalogItem,
  GBPCategory,
} from '../../types/gbpChecklist';
import type {
  HotelVisibilityAttestation,
  VisibilityBreakdown as VisibilityBreakdownT,
  VisibilitySignalKey,
} from '../../types/visibilityScore';

interface Props {
  hotelId: string;
  hotelSlug: string;
  breakdown: VisibilityBreakdownT;
  attestationsByKey: Partial<Record<VisibilitySignalKey, HotelVisibilityAttestation>>;
  isManager: boolean;
  /** Hotel description (for AUTO_DERIVED description_present rule). */
  hotelDescription?: string | null;
  /** Hotel amenities[] (for AUTO_DERIVED amenities_visible_on_gbp rule). */
  hotelAmenities?: string[] | null;
}

const VERIFIED_EXPIRY_DAYS = 90;

/**
 * Returns true when the LINKED_VISIBILITY item is "satisfied" for GBP
 * Checklist purposes. Mirrors SQL bridge function logic — accounts for 90d
 * manager-verification expiry.
 */
function isLinkedSatisfied(
  signalKey: VisibilitySignalKey,
  breakdown: VisibilityBreakdownT,
  attestationsByKey: Partial<Record<VisibilitySignalKey, HotelVisibilityAttestation>>,
): boolean {
  const signal = breakdown.signals.find((s) => s.key === signalKey);
  if (!signal) return false;
  if (signal.kind === 'AUTO_DERIVED') {
    return signal.satisfied;
  }
  // SELF_ATTESTED — check Visibility attestation row for 90d expiry
  const att = attestationsByKey[signalKey];
  if (!att) return false;
  if (att.state === 'MANAGER_VERIFIED' && att.manager_verified_at) {
    const age = (Date.now() - new Date(att.manager_verified_at).getTime()) / (24 * 60 * 60 * 1000);
    if (age > VERIFIED_EXPIRY_DAYS) return false;
    return true;
  }
  return att.state === 'SELF_ATTESTED';
}

/**
 * Returns true for the SELF_ATTESTED GBP item if owner has self-attested
 * (with 90d manager-verify expiry check).
 */
function isGBPSelfAttestedSatisfied(attestation: GBPAttestationRow | null): boolean {
  if (!attestation) return false;
  if (attestation.state === 'MANAGER_VERIFIED' && attestation.manager_verified_at) {
    const age = (Date.now() - new Date(attestation.manager_verified_at).getTime()) / (24 * 60 * 60 * 1000);
    if (age > VERIFIED_EXPIRY_DAYS) return false;
    return true;
  }
  return attestation.state === 'SELF_ATTESTED';
}

/**
 * AUTO_DERIVED rule evaluation, mirrors the SQL view CASE branches.
 * Optional `t` parameter enables localised reason strings when wired from
 * a component that has the owner-visibility namespace loaded.
 */
function isAutoDerivedSatisfied(
  itemKey: string,
  description: string | null | undefined,
  amenities: string[] | null | undefined,
  t?: OwnerT,
): { satisfied: boolean; reason: string } {
  const tr = (key: string, en: string, vars?: Record<string, unknown>) =>
    t ? t(key, en, vars) : en;
  switch (itemKey) {
    case 'description_present': {
      const len = (description ?? '').trim().length;
      return {
        satisfied: len >= 30,
        reason: len >= 30
          ? tr('gbp.descriptionSet', 'Description set ({{len}} chars).', { len })
          : len > 0
            ? tr('gbp.descriptionTooShort', 'Description too short ({{len}} chars; need ≥30).', { len })
            : tr('gbp.noDescription', 'No description set in property settings.'),
      };
    }
    case 'amenities_visible_on_gbp': {
      const count = amenities?.length ?? 0;
      return {
        satisfied: count >= 3,
        reason: count >= 3
          ? tr('gbp.amenitiesListed', '{{count}} amenities listed.', { count })
          : tr('gbp.amenitiesInsufficient', 'Only {{count}} amenities listed (need ≥3).', { count }),
      };
    }
    default:
      return { satisfied: false, reason: '' };
  }
}

export function GoogleBusinessChecklist({
  hotelId,
  hotelSlug,
  breakdown,
  attestationsByKey,
  isManager,
  hotelDescription,
  hotelAmenities,
}: Props) {
  const t = useOwnerT('owner-visibility');
  const lang = useOwnerLang();
  // Fetch GBP attestations for SELF_ATTESTED items
  const gbpAttQ = useQuery({
    queryKey: gbpChecklistQueryKeys.attestations(hotelId),
    queryFn: () => listGBPAttestations(hotelId),
    enabled: !!hotelId && GOOGLE_BUSINESS_CHECKLIST_V0_ENABLED,
    staleTime: 30_000,
  });

  // Default-open: top 3 categories (BUSINESS_PROFILE, LOCATION_ACCURACY, CONTACT_READINESS).
  const [openCats, setOpenCats] = useState<Set<GBPCategory>>(() =>
    new Set<GBPCategory>(['BUSINESS_PROFILE', 'LOCATION_ACCURACY', 'CONTACT_READINESS']),
  );
  const toggleCat = (c: GBPCategory) => {
    setOpenCats((s) => {
      const next = new Set(s);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  };

  const gbpByKey = useMemo(() => {
    const map: Record<string, GBPAttestationRow> = {};
    for (const a of gbpAttQ.data ?? []) map[a.item_key] = a;
    return map;
  }, [gbpAttQ.data]);

  // ── Compute per-item satisfaction for the summary ────────────────────────
  const summary = useMemo(() => {
    let satisfied = 0;
    let total = 0;
    const byCategory: Record<GBPCategory, { satisfied: number; total: number }> = {
      BUSINESS_PROFILE:        { satisfied: 0, total: 0 },
      LOCATION_ACCURACY:       { satisfied: 0, total: 0 },
      CONTACT_READINESS:       { satisfied: 0, total: 0 },
      CONTENT_READINESS:       { satisfied: 0, total: 0 },
      TRUST_SIGNALS:           { satisfied: 0, total: 0 },
      EXPERIENCE_READINESS:    { satisfied: 0, total: 0 },
      VERIFICATION_READINESS:  { satisfied: 0, total: 0 },
    };

    for (const item of GBP_CATALOG) {
      let isSat = false;
      if (item.kind === 'LINKED_VISIBILITY') {
        isSat = isLinkedSatisfied(item.linkedVisibilitySignalKey as VisibilitySignalKey, breakdown, attestationsByKey);
      } else if (item.kind === 'SELF_ATTESTED') {
        isSat = isGBPSelfAttestedSatisfied(gbpByKey[item.itemKey] ?? null);
      } else if (item.kind === 'AUTO_DERIVED') {
        isSat = isAutoDerivedSatisfied(item.itemKey, hotelDescription, hotelAmenities, t).satisfied;
      }
      total++;
      if (isSat) satisfied++;
      byCategory[item.category].total++;
      if (isSat) byCategory[item.category].satisfied++;
    }

    return { satisfied, total, byCategory };
  }, [breakdown, attestationsByKey, gbpByKey, hotelDescription, hotelAmenities]);

  const isReady = meetsGBPReadyThreshold(summary.satisfied, summary.total);
  const visibilityCategoryMax = VISIBILITY_CATEGORY_WEIGHT.GMB_READINESS; // 30
  const visibilityCategoryActual = breakdown.category_scores.GMB_READINESS;

  if (!GOOGLE_BUSINESS_CHECKLIST_V0_ENABLED) {
    // Legacy fallback: just the 6 GMB signals (matches prior shipped behaviour).
    const items = breakdown.signals.filter((s) => s.category === 'GMB_READINESS');
    return (
      <section
        className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-3"
        data-testid="gmb-checklist"
      >
        <header className="flex items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-2 text-[12px] font-semibold text-slate-100">
            <Globe className="h-4 w-4 text-sky-300" aria-hidden />
            {t('gbp.legacyTitle', 'Google Business checklist')}
          </h3>
          <span className="text-[11px] text-slate-300">
            {visibilityCategoryActual.toFixed(visibilityCategoryActual % 1 === 0 ? 0 : 1)} / {visibilityCategoryMax} {t('pts', 'pts')}
          </span>
        </header>
        <ul className="space-y-2">
          {items.map((s) => (
            <VisibilitySignalRow
              key={s.key}
              hotelId={hotelId}
              hotelSlug={hotelSlug}
              signal={s}
              attestation={attestationsByKey[s.key] ?? null}
              isManager={isManager}
            />
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border border-slate-800 bg-[#0F1320] p-4 space-y-4"
      data-testid="gmb-checklist"
    >
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-100">
            <Globe className="h-4 w-4 text-sky-300" aria-hidden />
            {t('gbp.title', 'Google Business Checklist')}
            <span className="inline-flex items-center rounded-md border border-sky-500/40 bg-sky-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-200">
              v0
            </span>
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-300">
              {t('gbp.items', '{{satisfied}} / {{total}} items', { satisfied: summary.satisfied, total: summary.total })}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                isReady
                  ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/40'
                  : 'bg-amber-500/15 text-amber-200 border border-amber-500/40'
              }`}
              title={`Ready when ≥${GBP_READY_THRESHOLD_PCT}% satisfied`}
            >
              {isReady ? t('gbp.ready', 'Ready (≥{{pct}}%)', { pct: GBP_READY_THRESHOLD_PCT }) : t('gbp.belowReady', 'Below {{pct}}%', { pct: GBP_READY_THRESHOLD_PCT })}
            </span>
          </div>
        </div>
        <p className="text-[11px] text-slate-400">{GBP_DISCLAIMER_EN}</p>
        <p className="text-[11px] text-slate-500">{GBP_DISCLAIMER_HI}</p>
      </header>

      {gbpAttQ.isLoading && (
        <div className="py-6 text-center">
          <Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-500" />
        </div>
      )}

      {!gbpAttQ.isLoading && GBP_CATEGORY_ORDER.map((cat) => {
        const items = GBP_CATALOG
          .filter((c) => c.category === cat)
          .sort((a, b) => a.displayOrder - b.displayOrder);
        const stat = summary.byCategory[cat];
        const isOpen = openCats.has(cat);
        return (
          <div key={cat} className="rounded-lg border border-slate-800 bg-[#0B0E14]">
            <button
              type="button"
              onClick={() => toggleCat(cat)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-800/30"
              aria-expanded={isOpen}
            >
              <div className="flex items-center gap-2">
                {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                <span className="text-[12px] font-medium text-slate-100">{t(`gbpCategory.${cat}`, GBP_CATEGORY_LABEL[cat])}</span>
              </div>
              <span className="text-[11px] text-slate-400">
                {stat.satisfied} / {stat.total}
              </span>
            </button>
            {isOpen && (
              <ul className="space-y-2 px-3 pb-3">
                {items.map((item) => renderItem(item, {
                  hotelId, hotelSlug, isManager,
                  breakdown, attestationsByKey,
                  gbpAttestation: gbpByKey[item.itemKey] ?? null,
                  hotelDescription, hotelAmenities, t,
                }))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}

interface RenderItemContext {
  hotelId: string;
  hotelSlug: string;
  isManager: boolean;
  breakdown: VisibilityBreakdownT;
  attestationsByKey: Partial<Record<VisibilitySignalKey, HotelVisibilityAttestation>>;
  gbpAttestation: GBPAttestationRow | null;
  hotelDescription: string | null | undefined;
  hotelAmenities: string[] | null | undefined;
  t: OwnerT;
}

function renderItem(item: GBPCatalogItem, ctx: RenderItemContext) {
  if (item.kind === 'LINKED_VISIBILITY' && item.linkedVisibilitySignalKey) {
    const signal = ctx.breakdown.signals.find((s) => s.key === item.linkedVisibilitySignalKey);
    if (!signal) {
      return (
        <li key={item.itemKey} className="rounded border border-slate-800 px-3 py-2 text-[11px] text-slate-500">
          {item.labelEn} — {ctx.t('signalNotAvailable', 'signal not available')}
        </li>
      );
    }
    return (
      <VisibilitySignalRow
        key={item.itemKey}
        hotelId={ctx.hotelId}
        hotelSlug={ctx.hotelSlug}
        signal={signal}
        attestation={ctx.attestationsByKey[item.linkedVisibilitySignalKey] ?? null}
        isManager={ctx.isManager}
      />
    );
  }

  if (item.kind === 'AUTO_DERIVED') {
    const { satisfied, reason } = isAutoDerivedSatisfied(item.itemKey, ctx.hotelDescription, ctx.hotelAmenities, ctx.t);
    return (
      <GBPChecklistRow
        key={item.itemKey}
        hotelId={ctx.hotelId}
        hotelSlug={ctx.hotelSlug}
        item={item}
        attestation={null}
        autoSatisfied={satisfied}
        autoReason={reason}
        isManager={ctx.isManager}
      />
    );
  }

  // SELF_ATTESTED
  return (
    <GBPChecklistRow
      key={item.itemKey}
      hotelId={ctx.hotelId}
      hotelSlug={ctx.hotelSlug}
      item={item}
      attestation={ctx.gbpAttestation}
      isManager={ctx.isManager}
    />
  );
}
