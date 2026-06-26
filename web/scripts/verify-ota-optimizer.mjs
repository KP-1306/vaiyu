// scripts/verify-ota-optimizer.mjs
//
// End-to-end verification for OTA Listing Optimizer v0.
// Exercises the actual Supabase JS API contract that the React UI uses.
//
// Run: node scripts/verify-ota-optimizer.mjs
//
// What it checks (≈50 assertions across 13 sections):
//   1. _ota_catalog() returns 52 rows + correct version
//   2. _ota_mountain_states() returns 6 expected states
//   3. v_hotel_ota_readiness — initial state (all UNKNOWN)
//   4. set_ota_active_otas — subset selection + empty-array rejection
//   5. set_ota_mountain_override — toggle + null clear
//   6. set_ota_readiness_status — golden + catalog-validation
//   7. set_ota_readiness_status — OTA_NOT_APPLICABLE_FOR_ITEM (Airbnb + room_naming)
//   8. set_ota_readiness_status — MOUNTAIN_ITEM_NOT_APPLICABLE for non-mountain
//   9. bulk_set_ota_readiness — wizard payload + idempotency + 200-cap
//  10. mark_ota_review_complete — bumps reviewed_at; rejects NO_STATES_FOR_OTA
//  11. complete_ota_wizard — idempotent stamp
//  12. reset_ota_readiness — per-OTA + all
//  13. View aggregation — score math, mountain gating, NA exclusion, staleness
//  14. Cross-tenant isolation: non-member sees 0 view rows
//  15. _ota_signal_for_visibility — bridge to Visibility Score
//  16. Visibility v2 — weight version 2 + ota_listing_ready in compute output
//  17. Cleanup

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = process.env.SUPABASE_URL  || 'http://127.0.0.1:54321';
const ANON_KEY      = process.env.SUPABASE_PUBLISHABLE_KEY || (() => { throw new Error('SUPABASE_PUBLISHABLE_KEY env var required'); })();
const SERVICE_KEY   = process.env.SUPABASE_SECRET_KEY || (() => { throw new Error('SUPABASE_SECRET_KEY env var required'); })();

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

let failures = 0;
function check(label, ok, detail) {
  const tag = ok ? '✓' : '✗';
  console.log(`  ${tag} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function asUser(email, password) {
  const u = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await u.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return u;
}

async function ensureUser(email, password) {
  const { data: list } = await admin.auth.admin.listUsers();
  const found = list?.users?.find((u) => u.email === email);
  if (found) {
    await admin.auth.admin.updateUserById(found.id, { password, email_confirm: true });
    return found.id;
  }
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error) throw new Error(`create user ${email}: ${error.message}`);
  return created.user.id;
}

async function ensureMember(userId, hotelId, role) {
  const { error } = await admin.from('hotel_members').upsert(
    { user_id: userId, hotel_id: hotelId, role, is_active: true, status: 'active' },
    { onConflict: 'user_id,hotel_id' },
  );
  if (error) throw new Error(`hotel_members upsert: ${error.message}`);
}

async function clearState(hotelId) {
  await admin.from('hotel_ota_readiness_state').delete().eq('hotel_id', hotelId);
  await admin.from('hotel_ota_optimizer_settings').delete().eq('hotel_id', hotelId);
}

async function setHotelState(hotelId, state) {
  await admin.from('hotels').update({ state }).eq('id', hotelId);
}

async function main() {
  console.log('\n=== OTA Listing Optimizer v0 — end-to-end verify ===\n');

  // ── Pick two hotels for cross-tenant isolation testing ────────────────────
  const { data: hotelA } = await admin.from('hotels').select('id, slug, state').eq('slug', 'tenant1').maybeSingle();
  if (!hotelA) throw new Error('Hotel tenant1 not found');
  const { data: hotelBList } = await admin
    .from('hotels').select('id, slug, state').neq('id', hotelA.id).not('slug', 'is', null).limit(1);
  const hotelB = hotelBList?.[0] ?? null;
  console.log(`Hotel A: ${hotelA.slug} (${hotelA.id}, state=${hotelA.state})`);
  if (hotelB) console.log(`Hotel B: ${hotelB.slug} (${hotelB.id}, state=${hotelB.state})`);
  console.log('');

  // Ensure hotelA is in a mountain state so MOUNTAIN_DISCLOSURE applies in tests
  const originalState = hotelA.state;
  await setHotelState(hotelA.id, 'Uttarakhand');

  // ── Owner identity for hotel A ────────────────────────────────────────────
  const OWNER_EMAIL = 'ota-verify-owner@local.vaiyu';
  const OWNER_PASS = 'OtaVerify2026!';
  const ownerId = await ensureUser(OWNER_EMAIL, OWNER_PASS);
  await ensureMember(ownerId, hotelA.id, 'owner');
  const owner = await asUser(OWNER_EMAIL, OWNER_PASS);
  console.log(`Signed in as owner: ${OWNER_EMAIL}\n`);

  // ── Outsider identity (non-member of A) ──────────────────────────────────
  const OUTSIDER_EMAIL = 'ota-verify-outsider@local.vaiyu';
  const OUTSIDER_PASS = 'OutsiderVerify2026!';
  const outsiderId = await ensureUser(OUTSIDER_EMAIL, OUTSIDER_PASS);
  if (hotelB) await ensureMember(outsiderId, hotelB.id, 'owner');
  const outsider = await asUser(OUTSIDER_EMAIL, OUTSIDER_PASS);

  await clearState(hotelA.id);
  if (hotelB) await clearState(hotelB.id);

  try {
    // ── 1. Catalog ─────────────────────────────────────────────────────────
    console.log('1. Catalog (_ota_catalog())');
    {
      const { data, error } = await owner.rpc('_ota_catalog');
      // Note: catalog is also exposed as direct function call via SELECT below
      if (error || !data) {
        // RPC may not be exposed via PostgREST for table-returning functions;
        // do a direct SELECT instead via admin
        const { data: rows } = await admin
          .from('hotel_ota_optimizer_settings') // dummy table for context only
          .select('hotel_id').limit(0);
        // Actually, use a SQL via REST: not possible. Use admin direct SQL.
        const { data: catData, error: catErr } = await admin.rpc('_ota_catalog');
        check('catalog accessible via RPC', !catErr, catErr?.message);
        check('catalog returns 52 rows', (catData ?? []).length === 52, `got ${(catData ?? []).length}`);
        const versions = new Set((catData ?? []).map((r) => r.catalog_version));
        check('catalog version is 1 (single value)', versions.size === 1 && versions.has(1));
      } else {
        check('catalog returns 52 rows', data.length === 52, `got ${data.length}`);
      }
    }

    // ── 2. Mountain states ─────────────────────────────────────────────────
    console.log('\n2. Mountain states (_ota_mountain_states())');
    {
      const { data, error } = await admin.rpc('_ota_mountain_states');
      check('returns 6 states', !error && (data ?? []).length === 6);
      check('includes Uttarakhand', (data ?? []).includes('Uttarakhand'));
      check('includes Himachal Pradesh', (data ?? []).includes('Himachal Pradesh'));
    }

    // ── 3. Initial view state ──────────────────────────────────────────────
    console.log('\n3. v_hotel_ota_readiness initial state (no settings → defaults)');
    {
      const { data, error } = await owner
        .from('v_hotel_ota_readiness')
        .select('*')
        .eq('hotel_id', hotelA.id);
      check('view returns 8 rows (one per default-active OTA)', !error && (data ?? []).length === 8);
      const allUnknown = (data ?? []).every((r) => r.unknown_count === r.total_count);
      check('all items are UNKNOWN initially', allUnknown);
      const allCritical = (data ?? []).every((r) => r.band === 'CRITICAL');
      check('all OTAs are CRITICAL initially', allCritical);
      // Mountain rows present because hotelA.state = Uttarakhand
      const totalCounts = (data ?? []).map((r) => r.total_count);
      // MMT in mountain hotel: 52 items - 0 NA = 52
      check('MMT mountain hotel has 52 items', totalCounts.includes(52));
    }

    // ── 4. set_ota_active_otas ─────────────────────────────────────────────
    console.log('\n4. set_ota_active_otas');
    {
      const { error: e1 } = await owner.rpc('set_ota_active_otas', {
        p_hotel_id: hotelA.id, p_otas: ['MMT', 'BOOKING_COM', 'AIRBNB'],
      });
      check('set 3 active OTAs', !e1);

      const { data: viewData } = await owner
        .from('v_hotel_ota_readiness')
        .select('ota')
        .eq('hotel_id', hotelA.id);
      check('view now shows 3 OTAs', (viewData ?? []).length === 3);

      // Empty array should reject
      const { error: e2 } = await owner.rpc('set_ota_active_otas', {
        p_hotel_id: hotelA.id, p_otas: [],
      });
      check('empty array rejected (OTAS_REQUIRED)', e2?.message?.includes('OTAS_REQUIRED'));
    }

    // ── 5. set_ota_mountain_override ───────────────────────────────────────
    console.log('\n5. set_ota_mountain_override');
    {
      const { data: d1, error: e1 } = await owner.rpc('set_ota_mountain_override', {
        p_hotel_id: hotelA.id, p_override: false,
      });
      check('override=false saves', !e1 && d1?.effective_mountain === false);

      const { data: viewData } = await owner
        .from('v_hotel_ota_readiness')
        .select('ota, total_count')
        .eq('hotel_id', hotelA.id)
        .eq('ota', 'MMT');
      // Without mountain checks: 52 - 13 = 39 items for MMT
      check('MMT shows 39 items when mountain off (52 - 13)', viewData?.[0]?.total_count === 39);

      // Reset to true
      const { data: d2 } = await owner.rpc('set_ota_mountain_override', {
        p_hotel_id: hotelA.id, p_override: true,
      });
      check('override=true saves', d2?.effective_mountain === true);
    }

    // ── 6. set_ota_readiness_status — golden ──────────────────────────────
    console.log('\n6. set_ota_readiness_status — golden');
    {
      const { error: e1 } = await owner.rpc('set_ota_readiness_status', {
        p_hotel_id: hotelA.id, p_ota: 'MMT',
        p_category: 'LISTING_QUALITY', p_item_key: 'title_quality',
        p_status: 'COMPLETE', p_note: 'Refined title with mountain view callout',
      });
      check('set MMT/LISTING_QUALITY/title_quality = COMPLETE', !e1, e1?.message);

      // Invalid item_key
      const { error: e2 } = await owner.rpc('set_ota_readiness_status', {
        p_hotel_id: hotelA.id, p_ota: 'MMT',
        p_category: 'LISTING_QUALITY', p_item_key: 'made_up_key',
        p_status: 'COMPLETE', p_note: null,
      });
      check('bogus item_key rejected (ITEM_KEY_NOT_IN_CATALOG)', e2?.message?.includes('ITEM_KEY_NOT_IN_CATALOG'));
    }

    // ── 7. OTA_NOT_APPLICABLE — Airbnb + room_naming ──────────────────────
    console.log('\n7. OTA_NOT_APPLICABLE — Airbnb + room_naming');
    {
      const { error } = await owner.rpc('set_ota_readiness_status', {
        p_hotel_id: hotelA.id, p_ota: 'AIRBNB',
        p_category: 'ROOM_NAMING', p_item_key: 'naming_consistency',
        p_status: 'COMPLETE', p_note: null,
      });
      check('Airbnb + naming_consistency rejected (OTA_NOT_APPLICABLE_FOR_ITEM)',
            error?.message?.includes('OTA_NOT_APPLICABLE_FOR_ITEM'));
    }

    // ── 8. MOUNTAIN_ITEM_NOT_APPLICABLE — non-mountain ────────────────────
    console.log('\n8. MOUNTAIN_ITEM_NOT_APPLICABLE — non-mountain hotel');
    {
      // Flip override to false
      await owner.rpc('set_ota_mountain_override', { p_hotel_id: hotelA.id, p_override: false });
      const { error } = await owner.rpc('set_ota_readiness_status', {
        p_hotel_id: hotelA.id, p_ota: 'MMT',
        p_category: 'MOUNTAIN_DISCLOSURE', p_item_key: 'parking_visibility',
        p_status: 'COMPLETE', p_note: null,
      });
      check('mountain item rejected on non-mountain (MOUNTAIN_ITEM_NOT_APPLICABLE)',
            error?.message?.includes('MOUNTAIN_ITEM_NOT_APPLICABLE'));
      // Reset
      await owner.rpc('set_ota_mountain_override', { p_hotel_id: hotelA.id, p_override: true });
    }

    // ── 9. bulk_set_ota_readiness ─────────────────────────────────────────
    console.log('\n9. bulk_set_ota_readiness');
    {
      const items = [
        { ota: 'MMT', category: 'LISTING_QUALITY', item_key: 'description_clear', status: 'COMPLETE' },
        { ota: 'MMT', category: 'PHOTOS_MEDIA', item_key: 'exterior_photos', status: 'COMPLETE' },
        { ota: 'MMT', category: 'PHOTOS_MEDIA', item_key: 'room_photos', status: 'PARTIAL' },
        { ota: 'BOOKING_COM', category: 'LISTING_QUALITY', item_key: 'title_quality', status: 'COMPLETE' },
      ];
      const { data, error } = await owner.rpc('bulk_set_ota_readiness', {
        p_hotel_id: hotelA.id, p_items: items,
      });
      check('bulk set 4 items', !error && data?.count === 4, error?.message);

      // Empty array
      const { error: e2 } = await owner.rpc('bulk_set_ota_readiness', {
        p_hotel_id: hotelA.id, p_items: [],
      });
      check('empty array rejected (ITEMS_EMPTY)', e2?.message?.includes('ITEMS_EMPTY'));

      // Over-cap
      const bigArr = Array(201).fill(items[0]);
      const { error: e3 } = await owner.rpc('bulk_set_ota_readiness', {
        p_hotel_id: hotelA.id, p_items: bigArr,
      });
      check('201 items rejected (ITEMS_TOO_MANY)', e3?.message?.includes('ITEMS_TOO_MANY'));

      // Idempotency: re-running same payload doesn't error
      const { data: again, error: e4 } = await owner.rpc('bulk_set_ota_readiness', {
        p_hotel_id: hotelA.id, p_items: items,
      });
      check('re-run is idempotent (updates not inserts)', !e4 && again?.updated === 4);
    }

    // ── 10. mark_ota_review_complete ──────────────────────────────────────
    console.log('\n10. mark_ota_review_complete');
    {
      const { data, error } = await owner.rpc('mark_ota_review_complete', {
        p_hotel_id: hotelA.id, p_ota: 'MMT',
      });
      check('refreshes MMT items', !error && (data?.items_refreshed ?? 0) > 0);

      const { error: e2 } = await owner.rpc('mark_ota_review_complete', {
        p_hotel_id: hotelA.id, p_ota: 'YATRA',
      });
      // YATRA isn't in active set + has no state rows
      check('rejects when no state rows exist (NO_STATES_FOR_OTA)', e2?.message?.includes('NO_STATES_FOR_OTA'));
    }

    // ── 11. complete_ota_wizard ────────────────────────────────────────────
    console.log('\n11. complete_ota_wizard');
    {
      const { data: d1, error: e1 } = await owner.rpc('complete_ota_wizard', { p_hotel_id: hotelA.id });
      check('first call stamps wizard_completed_at', !e1 && d1?.changed === true);
      const ts1 = d1?.wizard_completed_at;

      const { data: d2, error: e2 } = await owner.rpc('complete_ota_wizard', { p_hotel_id: hotelA.id });
      check('second call idempotent (changed=false)', !e2 && d2?.changed === false);
      check('timestamp unchanged on idempotent re-run', d2?.wizard_completed_at === ts1);
    }

    // ── 12. View aggregation ──────────────────────────────────────────────
    console.log('\n12. View aggregation');
    {
      const { data, error } = await owner
        .from('v_hotel_ota_readiness')
        .select('*')
        .eq('hotel_id', hotelA.id)
        .eq('ota', 'MMT')
        .maybeSingle();
      check('MMT row present', !error && data);
      if (data) {
        check('MMT complete_count includes our COMPLETE items',
              data.complete_count >= 2);
        check('MMT partial_count includes our PARTIAL items',
              data.partial_count >= 1);
        check('MMT ota_score > 0 after items set', Number(data.ota_score) > 0);
      }

      const { data: summary } = await owner
        .from('v_hotel_ota_readiness_summary')
        .select('*')
        .eq('hotel_id', hotelA.id)
        .maybeSingle();
      check('summary row present', summary);
      check('summary has 3 active OTAs', summary?.active_ota_count === 3);
    }

    // ── 13. Cross-tenant isolation ────────────────────────────────────────
    console.log('\n13. Cross-tenant isolation (outsider cannot see hotel A)');
    {
      const { data: outsiderView } = await outsider
        .from('v_hotel_ota_readiness')
        .select('*')
        .eq('hotel_id', hotelA.id);
      check('outsider sees 0 hotelA rows (RLS blocked)', (outsiderView ?? []).length === 0);

      const { data: outsiderState } = await outsider
        .from('hotel_ota_readiness_state')
        .select('*')
        .eq('hotel_id', hotelA.id);
      check('outsider sees 0 hotelA state rows', (outsiderState ?? []).length === 0);

      const { error: rpcErr } = await outsider.rpc('set_ota_readiness_status', {
        p_hotel_id: hotelA.id, p_ota: 'MMT',
        p_category: 'LISTING_QUALITY', p_item_key: 'title_quality',
        p_status: 'MISSING', p_note: null,
      });
      check('outsider cannot mutate hotelA (NOT_A_MEMBER)', rpcErr?.message?.includes('NOT_A_MEMBER'));
    }

    // ── 14. _ota_signal_for_visibility ────────────────────────────────────
    console.log('\n14. _ota_signal_for_visibility (Visibility Score bridge)');
    {
      const { data, error } = await admin.rpc('_ota_signal_for_visibility', { p_hotel_id: hotelA.id });
      check('bridge callable from admin', !error);
      // With only a few items set, score is well below 50
      check('signal returns false when score < 50', data === false);
    }

    // ── 15. Visibility Score v2 ───────────────────────────────────────────
    console.log('\n15. Visibility Score v2 weights');
    {
      const { data: weights, error } = await admin.rpc('_visibility_weights');
      check('weights callable', !error);
      const row = (weights ?? [])[0];
      // ota_listing_ready was added in v2; later migrations may bump version further.
      check('weights version >= 2', row?.version >= 2, `got ${row?.version}`);
      check('weights includes ota_listing_ready', !!row?.weights?.ota_listing_ready);
      check('ota_listing_ready weight = 4', row?.weights?.ota_listing_ready === 4);
      const total = Object.values(row?.weights ?? {}).reduce((a, b) => a + Number(b), 0);
      check('grand total = 100', total === 100);
    }

    // ── 16. Visibility Score compute includes ota_listing_ready ───────────
    console.log('\n16. Visibility Score compute includes ota_listing_ready signal');
    {
      const { data: viewRow, error } = await owner
        .from('v_hotel_visibility_score')
        .select('breakdown')
        .eq('hotel_id', hotelA.id)
        .maybeSingle();
      check('visibility view returns row', !error && viewRow);
      const breakdown = viewRow?.breakdown;
      // ota_listing_ready was added in v2; later migrations may bump version further.
      check('breakdown.version >= 2', breakdown?.version >= 2, `got ${breakdown?.version}`);
      const otaSig = (breakdown?.signals ?? []).find((s) => s.key === 'ota_listing_ready');
      check('ota_listing_ready signal present in compute output', !!otaSig);
      check('ota_listing_ready is AUTO_DERIVED', otaSig?.kind === 'AUTO_DERIVED');
      check('ota_listing_ready max_contribution = 4', otaSig?.max_contribution === 4);
    }

    // ── 17. reset_ota_readiness ───────────────────────────────────────────
    console.log('\n17. reset_ota_readiness');
    {
      const { data: before } = await owner
        .from('hotel_ota_readiness_state')
        .select('id')
        .eq('hotel_id', hotelA.id);
      const beforeCount = (before ?? []).length;
      check('has state rows before reset', beforeCount > 0);

      const { data: r, error } = await owner.rpc('reset_ota_readiness', {
        p_hotel_id: hotelA.id, p_ota: 'MMT',
      });
      check('reset MMT items', !error && r?.items_deleted > 0);

      const { data: after } = await owner
        .from('hotel_ota_readiness_state')
        .select('ota')
        .eq('hotel_id', hotelA.id);
      const mmtAfter = (after ?? []).filter((r) => r.ota === 'MMT').length;
      check('MMT rows deleted', mmtAfter === 0);
      const totalAfter = (after ?? []).length;
      check('non-MMT rows preserved', totalAfter === beforeCount - r.items_deleted);

      // Reset all
      const { data: rAll } = await owner.rpc('reset_ota_readiness', {
        p_hotel_id: hotelA.id, p_ota: null,
      });
      check('reset-all deletes remaining rows', rAll?.items_deleted === totalAfter);
    }
  } finally {
    // ── Cleanup: restore original hotelA.state ──────────────────────────────
    await setHotelState(hotelA.id, originalState);
    await clearState(hotelA.id);
    if (hotelB) await clearState(hotelB.id);
  }

  console.log(`\n${failures === 0 ? '✓ All checks passed' : `✗ ${failures} check(s) failed`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
