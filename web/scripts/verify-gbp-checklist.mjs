// scripts/verify-gbp-checklist.mjs
//
// End-to-end verification for Google Business Checklist v0.
//
// Run: node scripts/verify-gbp-checklist.mjs
//
// Sections (~40 checks):
//   1. _gbp_catalog() — 30 rows, kind distribution, category counts
//   2. v_hotel_gbp_readiness — initial state (all UNCLAIMED)
//   3. set_gbp_attestation — golden path + catalog validation
//   4. set_gbp_attestation — rejects AUTO_DERIVED + LINKED_VISIBILITY items
//   5. manager_verify_gbp_attestation — happy path
//   6. manager_verify — NOTHING_TO_VERIFY when not self-attested
//   7. manager_unverify — happy path + ATTESTATION_LOCKED + REASON_REQUIRED
//   8. AUTO_DERIVED items derive from hotels.description / amenities
//   9. LINKED_VISIBILITY items reflect Visibility attestations
//  10. v_hotel_gbp_readiness summary aggregates correctly
//  11. Cross-tenant isolation
//  12. _gbp_signal_for_visibility bridge — false < 70%, true >= 70%
//  13. Visibility v3 — version 3, gbp_checklist_ready weight 4
//  14. Visibility compute includes gbp_checklist_ready signal
//  15. Cleanup

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

async function clearGBP(hotelId) {
  await admin.from('gbp_checklist_attestations').delete().eq('hotel_id', hotelId);
}

async function clearVisibility(hotelId) {
  await admin.from('hotel_visibility_attestations').delete().eq('hotel_id', hotelId);
}

async function setHotelFields(hotelId, fields) {
  await admin.from('hotels').update(fields).eq('id', hotelId);
}

async function main() {
  console.log('\n=== Google Business Checklist v0 — end-to-end verify ===\n');

  // Pick hotelA + hotelB for cross-tenant
  const { data: hotelA } = await admin.from('hotels').select('id, slug, description, amenities').eq('slug', 'tenant1').maybeSingle();
  if (!hotelA) throw new Error('Hotel tenant1 not found');
  const { data: hotelBList } = await admin
    .from('hotels').select('id, slug').neq('id', hotelA.id).not('slug', 'is', null).limit(1);
  const hotelB = hotelBList?.[0] ?? null;
  console.log(`Hotel A: ${hotelA.slug} (${hotelA.id})`);
  if (hotelB) console.log(`Hotel B: ${hotelB.slug} (${hotelB.id})`);

  const originalA = { description: hotelA.description, amenities: hotelA.amenities };

  // Owners
  const OWNER_EMAIL = 'gbp-verify-owner@local.vaiyu';
  const OWNER_PASS = 'GbpVerify2026!';
  const ownerId = await ensureUser(OWNER_EMAIL, OWNER_PASS);
  await ensureMember(ownerId, hotelA.id, 'owner');
  const owner = await asUser(OWNER_EMAIL, OWNER_PASS);
  console.log(`Signed in as owner: ${OWNER_EMAIL}\n`);

  // Second manager (for ATTESTATION_LOCKED test)
  const MGR2_EMAIL = 'gbp-verify-mgr2@local.vaiyu';
  const MGR2_PASS = 'GbpMgr2Verify2026!';
  const mgr2Id = await ensureUser(MGR2_EMAIL, MGR2_PASS);
  await ensureMember(mgr2Id, hotelA.id, 'owner');  // owner role is fine for finance_manager check
  const mgr2 = await asUser(MGR2_EMAIL, MGR2_PASS);

  // Outsider
  const OUTSIDER_EMAIL = 'gbp-verify-outsider@local.vaiyu';
  const OUTSIDER_PASS = 'GbpOutsider2026!';
  const outsiderId = await ensureUser(OUTSIDER_EMAIL, OUTSIDER_PASS);
  if (hotelB) await ensureMember(outsiderId, hotelB.id, 'owner');
  const outsider = await asUser(OUTSIDER_EMAIL, OUTSIDER_PASS);

  await clearGBP(hotelA.id);
  if (hotelB) await clearGBP(hotelB.id);
  // Also clear Visibility attestations so we control GMB linked state
  await clearVisibility(hotelA.id);

  try {
    // ── 1. Catalog ─────────────────────────────────────────────────────────
    console.log('1. _gbp_catalog()');
    const { data: catData, error: catErr } = await admin.rpc('_gbp_catalog');
    check('catalog accessible', !catErr, catErr?.message);
    check('returns 30 rows', (catData ?? []).length === 30, `got ${(catData ?? []).length}`);

    const kindCounts = {};
    for (const r of catData ?? []) kindCounts[r.kind] = (kindCounts[r.kind] ?? 0) + 1;
    check('19 SELF_ATTESTED', kindCounts.SELF_ATTESTED === 19, `got ${kindCounts.SELF_ATTESTED}`);
    check('2 AUTO_DERIVED', kindCounts.AUTO_DERIVED === 2, `got ${kindCounts.AUTO_DERIVED}`);
    check('9 LINKED_VISIBILITY', kindCounts.LINKED_VISIBILITY === 9, `got ${kindCounts.LINKED_VISIBILITY}`);

    // ── 2. Initial readiness ──────────────────────────────────────────────
    console.log('\n2. v_hotel_gbp_readiness initial state');
    {
      const { data } = await owner
        .from('v_hotel_gbp_readiness')
        .select('*')
        .eq('hotel_id', hotelA.id)
        .maybeSingle();
      check('readiness row exists', !!data);
      check('total_count = 30', data?.total_count === 30, `got ${data?.total_count}`);
      check('satisfied_count starts low', (data?.satisfied_count ?? 0) <= 10);
      check('meets_ready_threshold = false initially', data?.meets_ready_threshold === false);
    }

    // ── 3. set_gbp_attestation golden path ────────────────────────────────
    console.log('\n3. set_gbp_attestation (golden)');
    {
      const { error } = await owner.rpc('set_gbp_attestation', {
        p_hotel_id: hotelA.id,
        p_item_key: 'signboard_photo_ready',
        p_state: 'SELF_ATTESTED',
        p_evidence_url: null,
      });
      check('self-attest signboard_photo_ready', !error, error?.message);

      const { error: e2 } = await owner.rpc('set_gbp_attestation', {
        p_hotel_id: hotelA.id,
        p_item_key: 'invalid_key',
        p_state: 'SELF_ATTESTED',
        p_evidence_url: null,
      });
      check('rejects invalid item_key', e2?.message?.includes('ITEM_KEY_NOT_IN_CATALOG'));
    }

    // ── 4. set_gbp_attestation rejects AUTO_DERIVED + LINKED_VISIBILITY ───
    console.log('\n4. set_gbp_attestation rejects read-only kinds');
    {
      const { error: e1 } = await owner.rpc('set_gbp_attestation', {
        p_hotel_id: hotelA.id,
        p_item_key: 'description_present',  // AUTO_DERIVED
        p_state: 'SELF_ATTESTED',
        p_evidence_url: null,
      });
      check('rejects AUTO_DERIVED (description_present)', e1?.message?.includes('ITEM_NOT_SELF_ATTESTABLE'));

      const { error: e2 } = await owner.rpc('set_gbp_attestation', {
        p_hotel_id: hotelA.id,
        p_item_key: 'profile_claimed',  // LINKED_VISIBILITY
        p_state: 'SELF_ATTESTED',
        p_evidence_url: null,
      });
      check('rejects LINKED_VISIBILITY (profile_claimed)', e2?.message?.includes('ITEM_NOT_SELF_ATTESTABLE'));
    }

    // ── 5. manager_verify happy path ───────────────────────────────────────
    console.log('\n5. manager_verify_gbp_attestation');
    {
      const { error } = await owner.rpc('manager_verify_gbp_attestation', {
        p_hotel_id: hotelA.id,
        p_item_key: 'signboard_photo_ready',
        p_note: 'Looks good',
      });
      check('verify signboard_photo_ready', !error, error?.message);
    }

    // ── 6. manager_verify NOTHING_TO_VERIFY ────────────────────────────────
    console.log('\n6. manager_verify rejects un-attested');
    {
      const { error } = await owner.rpc('manager_verify_gbp_attestation', {
        p_hotel_id: hotelA.id,
        p_item_key: 'letterhead_ready',  // not yet attested
        p_note: null,
      });
      check('NOTHING_TO_VERIFY raised', error?.message?.includes('NOTHING_TO_VERIFY'));
    }

    // ── 7. manager_unverify rules ──────────────────────────────────────────
    console.log('\n7. manager_unverify_gbp_attestation');
    {
      // REASON_REQUIRED
      const { error: e1 } = await owner.rpc('manager_unverify_gbp_attestation', {
        p_hotel_id: hotelA.id,
        p_item_key: 'signboard_photo_ready',
        p_reason: '',
      });
      check('REASON_REQUIRED when empty', e1?.message?.includes('REASON_REQUIRED'));

      // ATTESTATION_LOCKED — second manager tries to unverify the first one's verify
      const { error: e2 } = await mgr2.rpc('manager_unverify_gbp_attestation', {
        p_hotel_id: hotelA.id,
        p_item_key: 'signboard_photo_ready',
        p_reason: 'Trying as different manager',
      });
      check('ATTESTATION_LOCKED for different manager', e2?.message?.includes('ATTESTATION_LOCKED'));

      // Original verifier can unverify
      const { error: e3 } = await owner.rpc('manager_unverify_gbp_attestation', {
        p_hotel_id: hotelA.id,
        p_item_key: 'signboard_photo_ready',
        p_reason: 'Photo turned out blurry — owner uploading new one',
      });
      check('original verifier can unverify', !e3, e3?.message);
    }

    // ── 8. AUTO_DERIVED items derive from hotels ──────────────────────────
    console.log('\n8. AUTO_DERIVED items (description / amenities)');
    {
      // Set description to >30 chars and amenities to 3+
      await setHotelFields(hotelA.id, {
        description: 'A welcoming boutique hotel in the heart of the mountains, with views, dining and great breakfast.',
        amenities: ['WiFi', 'Parking', 'Breakfast', 'AC'],
      });
      const { data: viewData } = await owner
        .from('v_hotel_gbp_readiness')
        .select('satisfied_count, total_count')
        .eq('hotel_id', hotelA.id)
        .maybeSingle();
      check('readiness reflects AUTO_DERIVED satisfaction', (viewData?.satisfied_count ?? 0) >= 2);

      // Now break them
      await setHotelFields(hotelA.id, {
        description: 'Short',  // < 30 chars
        amenities: ['WiFi'],   // < 3
      });
      const { data: viewData2 } = await owner
        .from('v_hotel_gbp_readiness')
        .select('satisfied_count')
        .eq('hotel_id', hotelA.id)
        .maybeSingle();
      const dropped = (viewData?.satisfied_count ?? 0) - (viewData2?.satisfied_count ?? 0);
      check('breaking AUTO_DERIVED drops satisfied count', dropped >= 2);

      // Restore
      await setHotelFields(hotelA.id, {
        description: originalA.description,
        amenities: originalA.amenities,
      });
    }

    // ── 9. LINKED_VISIBILITY reflects Visibility attestations ──────────────
    console.log('\n9. LINKED_VISIBILITY items reflect Visibility attestations');
    {
      // Owner self-attests gmb_claimed via Visibility's RPC
      await owner.rpc('set_visibility_attestation', {
        p_hotel_id: hotelA.id,
        p_signal_key: 'gmb_claimed',
        p_state: 'SELF_ATTESTED',
        p_evidence_url: null,
      });
      const { data: viewData } = await owner
        .from('v_hotel_gbp_readiness')
        .select('satisfied_count')
        .eq('hotel_id', hotelA.id)
        .maybeSingle();
      check('LINKED_VISIBILITY satisfaction visible in GBP readiness', (viewData?.satisfied_count ?? 0) >= 1);
    }

    // ── 10. Summary aggregation ───────────────────────────────────────────
    console.log('\n10. Summary view aggregates correctly');
    {
      const { data } = await owner
        .from('v_hotel_gbp_readiness')
        .select('*')
        .eq('hotel_id', hotelA.id)
        .maybeSingle();
      check('overall_score is a number 0-100', typeof data?.overall_score === 'number' && data.overall_score >= 0 && data.overall_score <= 100);
      check('hotel_slug exposed', data?.hotel_slug === hotelA.slug);
      check('hotel_name exposed', !!data?.hotel_name);
    }

    // ── 11. Cross-tenant isolation ────────────────────────────────────────
    console.log('\n11. Cross-tenant isolation');
    {
      const { data: outsiderView } = await outsider
        .from('v_hotel_gbp_readiness')
        .select('*')
        .eq('hotel_id', hotelA.id);
      check('outsider sees 0 hotelA view rows', (outsiderView ?? []).length === 0);

      const { data: outsiderAtt } = await outsider
        .from('gbp_checklist_attestations')
        .select('*')
        .eq('hotel_id', hotelA.id);
      check('outsider sees 0 hotelA attestation rows', (outsiderAtt ?? []).length === 0);

      const { error: rpcErr } = await outsider.rpc('set_gbp_attestation', {
        p_hotel_id: hotelA.id,
        p_item_key: 'letterhead_ready',
        p_state: 'SELF_ATTESTED',
        p_evidence_url: null,
      });
      check('outsider cannot mutate hotelA (NOT_A_MEMBER)', rpcErr?.message?.includes('NOT_A_MEMBER'));
    }

    // ── 12. Bridge function ───────────────────────────────────────────────
    console.log('\n12. _gbp_signal_for_visibility bridge');
    {
      // Currently we have ~3 items satisfied (gmb_claimed linked + 2 AUTO_DERIVED restored to original).
      // 3 < 21 → false
      const { data } = await admin.rpc('_gbp_signal_for_visibility', { p_hotel_id: hotelA.id });
      check('bridge callable', data !== null && data !== undefined);
      check('bridge returns false when below 70%', data === false);

      // Now attest 21+ items
      const itemsToAttest = (catData ?? [])
        .filter((c) => c.kind === 'SELF_ATTESTED')
        .slice(0, 19)
        .map((c) => c.item_key);
      for (const k of itemsToAttest) {
        await owner.rpc('set_gbp_attestation', {
          p_hotel_id: hotelA.id, p_item_key: k, p_state: 'SELF_ATTESTED', p_evidence_url: null,
        });
      }
      const { data: data2 } = await admin.rpc('_gbp_signal_for_visibility', { p_hotel_id: hotelA.id });
      check('bridge returns true when ≥70% satisfied', data2 === true);
    }

    // ── 13. Visibility v3 weights ─────────────────────────────────────────
    console.log('\n13. Visibility v3 weights');
    {
      const { data: weights } = await admin.rpc('_visibility_weights');
      const row = (weights ?? [])[0];
      check('version = 3', row?.version === 3);
      check('gbp_checklist_ready weight = 4', row?.weights?.gbp_checklist_ready === 4);
      const total = Object.values(row?.weights ?? {}).reduce((a, b) => a + Number(b), 0);
      check('grand total = 100', total === 100);
    }

    // ── 14. Visibility compute includes gbp signal ────────────────────────
    console.log('\n14. Visibility compute includes gbp_checklist_ready');
    {
      const { data: viewRow } = await owner
        .from('v_hotel_visibility_score')
        .select('breakdown')
        .eq('hotel_id', hotelA.id)
        .maybeSingle();
      const breakdown = viewRow?.breakdown;
      check('breakdown.version = 3', breakdown?.version === 3);
      const gbpSig = (breakdown?.signals ?? []).find((s) => s.key === 'gbp_checklist_ready');
      check('gbp_checklist_ready signal present', !!gbpSig);
      check('signal kind AUTO_DERIVED', gbpSig?.kind === 'AUTO_DERIVED');
      check('signal max_contribution = 4', gbpSig?.max_contribution === 4);
      check('signal satisfied = true (since we attested 19 items)', gbpSig?.satisfied === true);
    }
  } finally {
    // Cleanup
    await clearGBP(hotelA.id);
    await clearVisibility(hotelA.id);
    await setHotelFields(hotelA.id, {
      description: originalA.description,
      amenities: originalA.amenities,
    });
  }

  console.log(`\n${failures === 0 ? '✓ All checks passed' : `✗ ${failures} check(s) failed`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
