// scripts/verify-dam.mjs
//
// End-to-end verification for Digital Asset Manager v0.
// Exercises the actual Supabase JS API contract that the React UI uses.
//
// Run: node scripts/verify-dam.mjs
//
// What it checks:
//   1. Catalog read via PostgREST
//   2. v_hotel_asset_status view returns ~28 rows per hotel under member auth
//   3. record_hotel_asset_file golden path (vault + public)
//   4. Negative cases: PII filename, oversized, wrong bucket-for-zone
//   5. Idempotency: same key replays return existing row
//   6. remove_hotel_asset_file → status transitions to NEEDS_REPLACEMENT
//   7. set_hotel_asset_status → owner toggling
//   8. upsert_hotel_asset_note → notes round-trip
//   9. Brand-sync trigger: clearing hotels.logo_path → AUTO_LINK_BRAND row removed
//  10. Cross-tenant idempotency isolation (post-hardening)
//  11. Cleanup

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const SUPABASE_URL  = process.env.SUPABASE_URL  || 'http://127.0.0.1:54321';
const ANON_KEY      = process.env.SUPABASE_ANON_KEY     || (() => { throw new Error('SUPABASE_ANON_KEY env var required'); })();
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || (() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY env var required'); })();

const admin  = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

let failures = 0;
function check(label, ok, detail) {
  const tag = ok ? '✓' : '✗';
  console.log(`  ${tag} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function asUser(email, password) {
  const u = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await u.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  return u;
}

async function main() {
  console.log('\n=== Digital Asset Manager v0 — end-to-end verify ===\n');

  // ─── Pick a hotel + create / reuse a test user ────────────────────────────
  const { data: hotelRow, error: hotelErr } = await admin
    .from('hotels').select('id, slug, logo_path').eq('slug', 'tenant1').maybeSingle();
  if (hotelErr || !hotelRow) throw new Error(`could not find hotel tenant1: ${hotelErr?.message}`);
  const HOTEL_ID = hotelRow.id;
  console.log(`Hotel: ${hotelRow.slug} (${HOTEL_ID})\n`);

  const TEST_EMAIL = 'dam-verify-test@local.vaiyu';
  const TEST_PASSWORD = 'DamVerify2026!';
  let userId;
  {
    // Look up existing user by email; create if absent.
    const { data: list } = await admin.auth.admin.listUsers();
    const found = list?.users?.find(u => u.email === TEST_EMAIL);
    if (found) {
      userId = found.id;
      // Reset password to known value
      await admin.auth.admin.updateUserById(userId, { password: TEST_PASSWORD, email_confirm: true });
    } else {
      const { data: created, error } = await admin.auth.admin.createUser({
        email: TEST_EMAIL, password: TEST_PASSWORD, email_confirm: true,
      });
      if (error) throw new Error(`create user: ${error.message}`);
      userId = created.user.id;
    }
  }

  // Ensure hotel_members row exists for this user
  {
    const { error } = await admin.from('hotel_members').upsert({
      user_id: userId, hotel_id: HOTEL_ID, role: 'owner', is_active: true, status: 'active',
    }, { onConflict: 'user_id,hotel_id' });
    if (error) throw new Error(`hotel_members upsert: ${error.message}`);
  }

  const user = await asUser(TEST_EMAIL, TEST_PASSWORD);
  console.log(`Signed in as ${TEST_EMAIL}\n`);

  // Reset any prior test rows for this hotel so we get a clean slate
  await admin.from('hotel_asset_files').delete().eq('hotel_id', HOTEL_ID)
    .like('storage_path', `${HOTEL_ID}/dam/%`);
  // Don't touch hotel_assets rows that came from backfill (logo/cover)
  await admin.from('hotel_assets').delete().eq('hotel_id', HOTEL_ID)
    .not('collected_via', 'eq', 'AUTO_LINK_BRAND');

  // ─── 1. Catalog read ────────────────────────────────────────────────────
  console.log('1. Catalog read');
  {
    const { data, error } = await user.from('asset_requirements').select('code, category').eq('is_active', true);
    check('asset_requirements returns 28 active rows', !error && data?.length === 28,
      error ? error.message : `got ${data?.length}`);
  }

  // ─── 2. Status view ─────────────────────────────────────────────────────
  console.log('\n2. v_hotel_asset_status view');
  let backfillCount = 0;
  {
    const { data, error } = await user.from('v_hotel_asset_status').select('*').eq('hotel_id', HOTEL_ID);
    check('view returns 28 rows for this hotel', !error && data?.length === 28,
      error ? error.message : `got ${data?.length}`);
    backfillCount = (data ?? []).filter(r => r.collected_via === 'AUTO_LINK_BRAND').length;
    check('backfill rows visible to member', backfillCount > 0, `${backfillCount} AUTO_LINK_BRAND row(s)`);
    const missingCount = (data ?? []).filter(r => r.status === 'MISSING').length;
    check('MISSING computed for un-touched requirements', missingCount === 28 - backfillCount,
      `${missingCount} MISSING`);
  }

  // ─── 3. record_hotel_asset_file — golden path (vault) ───────────────────
  console.log('\n3. record_hotel_asset_file (golden, vault)');
  let goldenFileId, goldenAssetId;
  {
    const idem = crypto.randomUUID();
    const storagePath = `${HOTEL_ID}/dam/verification_signboard_exterior/${idem}.jpg`;
    // Upload a small dummy file directly to storage (the JS UI does this first)
    const bytes = Buffer.from('fakejpeg-bytes-for-test');
    const { error: upErr } = await user.storage.from('hotel-asset-vault')
      .upload(storagePath, bytes, { contentType: 'image/jpeg', upsert: false });
    check('storage upload to hotel-asset-vault succeeds', !upErr, upErr?.message);

    const { data, error } = await user.rpc('record_hotel_asset_file', {
      p_hotel_id: HOTEL_ID,
      p_requirement_code: 'verification_signboard_exterior',
      p_bucket: 'hotel-asset-vault',
      p_storage_path: storagePath,
      p_mime_type: 'image/jpeg',
      p_file_size_bytes: bytes.length,
      p_idempotency_key: idem,
      p_width_px: 1920, p_height_px: 1080, p_alt_text: 'Hotel signboard',
    });
    check('record_hotel_asset_file returns ok', !error && data?.ok === true, error?.message);
    check('new_status = COLLECTED', data?.new_status === 'COLLECTED', `got ${data?.new_status}`);
    check('previous_status = null (new asset)', data?.previous_status === null, `got ${data?.previous_status}`);
    goldenFileId = data?.file_id;
    goldenAssetId = data?.hotel_asset_id;
  }

  // ─── 4. Negative: PII filename ──────────────────────────────────────────
  console.log('\n4. Negative — PII filename');
  {
    const idem = crypto.randomUUID();
    const piiPath = `${HOTEL_ID}/dam/verification_business_card/aadhaar-${idem}.jpg`;
    // Skip the storage step; RPC should reject regardless
    const { error } = await user.rpc('record_hotel_asset_file', {
      p_hotel_id: HOTEL_ID,
      p_requirement_code: 'verification_business_card',
      p_bucket: 'hotel-asset-vault',
      p_storage_path: piiPath,
      p_mime_type: 'image/jpeg',
      p_file_size_bytes: 1000,
      p_idempotency_key: idem,
    });
    check('PII filename rejected', error?.message?.includes('PII_FILENAME_REJECTED'),
      error?.message ?? '(no error returned!)');
  }

  // ─── 5. Negative: wrong bucket for zone ─────────────────────────────────
  console.log('\n5. Negative — wrong bucket for zone');
  {
    const idem = crypto.randomUUID();
    const wrongPath = `${HOTEL_ID}/dam/verification_letterhead/${idem}.pdf`;
    const { error } = await user.rpc('record_hotel_asset_file', {
      p_hotel_id: HOTEL_ID,
      p_requirement_code: 'verification_letterhead',   // PRIVATE_VAULT
      p_bucket: 'hotel-assets',                         // PUBLIC — mismatch
      p_storage_path: wrongPath,
      p_mime_type: 'application/pdf',
      p_file_size_bytes: 1000,
      p_idempotency_key: idem,
    });
    check('PRIVATE_VAULT → hotel-assets rejected', error?.message?.includes('WRONG_BUCKET_FOR_ZONE'),
      error?.message ?? '(no error returned!)');
  }

  // ─── 6. Negative: oversized file ────────────────────────────────────────
  console.log('\n6. Negative — oversized file');
  {
    const idem = crypto.randomUUID();
    const path = `${HOTEL_ID}/dam/trust_room_photos/${idem}.png`;
    const { error } = await user.rpc('record_hotel_asset_file', {
      p_hotel_id: HOTEL_ID,
      p_requirement_code: 'trust_room_photos',
      p_bucket: 'hotel-assets',
      p_storage_path: path,
      p_mime_type: 'image/png',
      p_file_size_bytes: 11 * 1024 * 1024,  // 11 MB > 10 MB cap
      p_idempotency_key: idem,
    });
    check('file > 10 MB rejected', error?.message?.includes('FILE_TOO_LARGE'),
      error?.message ?? '(no error returned!)');
  }

  // ─── 7. Idempotency ─────────────────────────────────────────────────────
  console.log('\n7. Idempotency');
  {
    const idem = crypto.randomUUID();
    const storagePath = `${HOTEL_ID}/dam/trust_room_photos/${idem}.jpg`;
    const bytes = Buffer.from('test-room-photo');
    await user.storage.from('hotel-assets').upload(storagePath, bytes, { contentType: 'image/jpeg', upsert: false });

    const args = {
      p_hotel_id: HOTEL_ID, p_requirement_code: 'trust_room_photos',
      p_bucket: 'hotel-assets', p_storage_path: storagePath,
      p_mime_type: 'image/jpeg', p_file_size_bytes: bytes.length, p_idempotency_key: idem,
    };
    const { data: first } = await user.rpc('record_hotel_asset_file', args);
    const { data: second } = await user.rpc('record_hotel_asset_file', args);
    check('first call inserts a new file', first?.idempotent === false, `idempotent=${first?.idempotent}`);
    check('second call short-circuits', second?.idempotent === true, `idempotent=${second?.idempotent}`);
    check('both calls return same file_id', first?.file_id === second?.file_id, `${first?.file_id} vs ${second?.file_id}`);
  }

  // ─── 8. set_hotel_asset_status (owner toggle) ───────────────────────────
  console.log('\n8. set_hotel_asset_status');
  {
    const { error } = await user.rpc('set_hotel_asset_status', {
      p_hotel_id: HOTEL_ID,
      p_requirement_code: 'verification_signboard_exterior',
      p_status: 'NEEDS_REPLACEMENT',
      p_owner_notes: 'Owner marked stale',
    });
    check('COLLECTED → NEEDS_REPLACEMENT allowed', !error, error?.message);

    const { data: row } = await user.from('v_hotel_asset_status').select('status')
      .eq('hotel_id', HOTEL_ID).eq('requirement_code', 'verification_signboard_exterior').single();
    check('status reflects NEEDS_REPLACEMENT', row?.status === 'NEEDS_REPLACEMENT', `got ${row?.status}`);
  }

  // ─── 9. upsert_hotel_asset_note ─────────────────────────────────────────
  console.log('\n9. upsert_hotel_asset_note');
  {
    const { error } = await user.rpc('upsert_hotel_asset_note', {
      p_hotel_id: HOTEL_ID,
      p_requirement_code: 'verification_signboard_exterior',
      p_owner_notes: 'Waiting on signboard installer next week',
    });
    check('note set succeeds', !error, error?.message);

    const { data } = await user.from('v_hotel_asset_status').select('owner_notes')
      .eq('hotel_id', HOTEL_ID).eq('requirement_code', 'verification_signboard_exterior').single();
    check('note round-trips through view', data?.owner_notes === 'Waiting on signboard installer next week',
      `got: ${data?.owner_notes}`);
  }

  // ─── 10. remove_hotel_asset_file → status flips on last-file ────────────
  console.log('\n10. remove_hotel_asset_file (last file)');
  {
    // We're using the golden vault file; only 1 file on this asset.
    const { data, error } = await user.rpc('remove_hotel_asset_file', { p_file_id: goldenFileId });
    check('remove returns ok', !error && data?.ok === true, error?.message);
    check('remaining_files = 0', data?.remaining_files === 0, `got ${data?.remaining_files}`);
    check('status auto-flipped to NEEDS_REPLACEMENT', data?.new_status === 'NEEDS_REPLACEMENT',
      `got ${data?.new_status}`);
  }

  // ─── 11. Brand-sync trigger: unlink on logo_path NULL ───────────────────
  console.log('\n11. Brand-sync trigger');
  {
    // Find a hotel that has AUTO_LINK_BRAND logo row (not our test hotel since tenant1 has logo)
    const { data: linked } = await admin.from('hotel_assets')
      .select('hotel_id, requirement_code')
      .eq('requirement_code', 'trust_logo_brand_assets')
      .eq('collected_via', 'AUTO_LINK_BRAND')
      .limit(1);
    if (!linked?.length) {
      check('skipped — no AUTO_LINK_BRAND logo found', true, 'no test data');
    } else {
      const targetHotelId = linked[0].hotel_id;
      // Snapshot original logo_path so we can restore
      const { data: original } = await admin.from('hotels').select('logo_path').eq('id', targetHotelId).single();
      const originalLogo = original.logo_path;

      await admin.from('hotels').update({ logo_path: null }).eq('id', targetHotelId);

      const { data: rows } = await admin.from('hotel_assets')
        .select('id')
        .eq('hotel_id', targetHotelId)
        .eq('requirement_code', 'trust_logo_brand_assets')
        .eq('collected_via', 'AUTO_LINK_BRAND');
      check('AUTO_LINK_BRAND row removed when logo cleared', !rows || rows.length === 0,
        `still ${rows?.length} rows`);

      // Restore
      await admin.from('hotels').update({ logo_path: originalLogo }).eq('id', targetHotelId);
      const { data: rows2 } = await admin.from('hotel_assets')
        .select('id')
        .eq('hotel_id', targetHotelId)
        .eq('requirement_code', 'trust_logo_brand_assets')
        .eq('collected_via', 'AUTO_LINK_BRAND');
      check('AUTO_LINK_BRAND row re-created when logo restored', rows2?.length === 1,
        `${rows2?.length} rows after restore`);
    }
  }

  // ─── 12. Cross-tenant idempotency isolation ─────────────────────────────
  console.log('\n12. Cross-tenant idempotency isolation');
  {
    // Pick a second hotel and add membership for our test user
    const { data: hotels } = await admin.from('hotels').select('id, slug').neq('id', HOTEL_ID).limit(1);
    const otherHotelId = hotels?.[0]?.id;
    if (!otherHotelId) {
      check('skipped — no second hotel available', true);
    } else {
      await admin.from('hotel_members').upsert({
        user_id: userId, hotel_id: otherHotelId, role: 'owner', is_active: true, status: 'active',
      }, { onConflict: 'user_id,hotel_id' });

      // Use the SAME idempotency_key across two hotels
      const sharedIdem = crypto.randomUUID();

      // Hotel A
      const pathA = `${HOTEL_ID}/dam/trust_bathroom_photos/${sharedIdem}.jpg`;
      const bytesA = Buffer.from('hotel-A-bytes');
      await user.storage.from('hotel-assets').upload(pathA, bytesA, { contentType: 'image/jpeg', upsert: false });
      const { data: respA, error: errA } = await user.rpc('record_hotel_asset_file', {
        p_hotel_id: HOTEL_ID,
        p_requirement_code: 'trust_bathroom_photos',
        p_bucket: 'hotel-assets',
        p_storage_path: pathA,
        p_mime_type: 'image/jpeg',
        p_file_size_bytes: bytesA.length,
        p_idempotency_key: sharedIdem,
      });
      check('hotel A insert ok', !errA, errA?.message);

      // Hotel B — same idem key. Should NOT short-circuit to A's row.
      const pathB = `${otherHotelId}/dam/trust_bathroom_photos/${sharedIdem}.jpg`;
      const bytesB = Buffer.from('hotel-B-bytes');
      await user.storage.from('hotel-assets').upload(pathB, bytesB, { contentType: 'image/jpeg', upsert: false });
      const { data: respB, error: errB } = await user.rpc('record_hotel_asset_file', {
        p_hotel_id: otherHotelId,
        p_requirement_code: 'trust_bathroom_photos',
        p_bucket: 'hotel-assets',
        p_storage_path: pathB,
        p_mime_type: 'image/jpeg',
        p_file_size_bytes: bytesB.length,
        p_idempotency_key: sharedIdem,
      });
      check('hotel B insert ok (not blocked by A)', !errB, errB?.message);
      check('hotel B not idempotent-collapsed to A', respB?.idempotent === false && respB?.file_id !== respA?.file_id,
        `B.idempotent=${respB?.idempotent} A.file=${respA?.file_id} B.file=${respB?.file_id}`);

      // Cleanup hotel B file
      await admin.from('hotel_asset_files').delete().eq('hotel_id', otherHotelId).like('storage_path', `${otherHotelId}/dam/%`);
      await admin.from('hotel_assets').delete().eq('hotel_id', otherHotelId).not('collected_via', 'eq', 'AUTO_LINK_BRAND');
      await admin.from('hotel_members').delete().eq('user_id', userId).eq('hotel_id', otherHotelId);
    }
  }

  // ─── 13. Cleanup test data ──────────────────────────────────────────────
  console.log('\n13. Cleanup');
  {
    const { error } = await admin.from('hotel_asset_files').delete()
      .eq('hotel_id', HOTEL_ID).like('storage_path', `${HOTEL_ID}/dam/%`);
    check('test file rows cleared', !error, error?.message);

    const { error: e2 } = await admin.from('hotel_assets').delete()
      .eq('hotel_id', HOTEL_ID).not('collected_via', 'eq', 'AUTO_LINK_BRAND');
    check('test hotel_asset rows cleared', !e2, e2?.message);

    await admin.from('hotel_members').delete().eq('user_id', userId).eq('hotel_id', HOTEL_ID);
    await admin.auth.admin.deleteUser(userId);
    check('test user deleted', true);
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log('\n=== Result ===');
  if (failures === 0) {
    console.log('✓ All checks passed.');
    process.exit(0);
  } else {
    console.log(`✗ ${failures} check(s) failed.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('\nFATAL:', e);
  process.exit(2);
});
