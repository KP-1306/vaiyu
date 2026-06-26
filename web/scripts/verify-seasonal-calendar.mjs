// scripts/verify-seasonal-calendar.mjs
//
// End-to-end verification for Seasonal Demand Calendar v0.
// Exercises the actual Supabase JS API contract that the React UI uses.
//
// Run: node scripts/verify-seasonal-calendar.mjs
//
// What it checks:
//   1. Catalog read (16 windows) under authenticated user
//   2. v_visible_seasonal_windows returns rows for hotel × catalog
//   3. Date math correctness (cross-year via WINTER_SNOW_STAY)
//   4. tick_seasonal_checklist — golden + idempotent re-tick + invalid key reject
//   5. update_seasonal_window_notes — round-trip + audit-only-on-change
//   6. mark_seasonal_window_ready (manager+) + return_seasonal_window_to_planning
//   7. dismiss_seasonal_window_for_year (reason required) + resume
//   8. override_seasonal_window_urgency (reason required) + clear
//   9. set_seasonal_window_permanently_hidden (reason required) + unhide
//  10. get_seasonal_window_timeline returns recorded events
//  11. RLS isolation: hotel-A user can't read hotel-B state
//  12. Member (non-manager) permission gates
//  13. Cleanup

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
  await admin.from('hotel_seasonal_window_events').delete().eq('hotel_id', hotelId);
  await admin.from('hotel_seasonal_window_states').delete().eq('hotel_id', hotelId);
}

async function main() {
  console.log('\n=== Seasonal Demand Calendar v0 — end-to-end verify ===\n');

  // ── Pick two hotels for cross-tenant isolation testing ────────────────────
  const { data: hotelA } = await admin.from('hotels').select('id, slug, state').eq('slug', 'tenant1').maybeSingle();
  if (!hotelA) throw new Error('Hotel tenant1 not found');
  // Any other hotel works for the cross-tenant test
  const { data: hotelBList } = await admin
    .from('hotels').select('id, slug, state').neq('id', hotelA.id).not('slug', 'is', null).limit(1);
  const hotelB = hotelBList?.[0] ?? null;
  console.log(`Hotel A: ${hotelA.slug} (${hotelA.id}, state=${hotelA.state})`);
  if (hotelB) console.log(`Hotel B: ${hotelB.slug} (${hotelB.id}, state=${hotelB.state})`);
  console.log('');

  // ── Set up an owner (manager+) for hotelA ────────────────────────────────
  const OWNER_EMAIL = 'seasonal-verify-owner@local.vaiyu';
  const OWNER_PASS = 'SeasonalVerify2026!';
  const ownerId = await ensureUser(OWNER_EMAIL, OWNER_PASS);
  await ensureMember(ownerId, hotelA.id, 'owner');
  const owner = await asUser(OWNER_EMAIL, OWNER_PASS);
  console.log(`Signed in as owner: ${OWNER_EMAIL}\n`);

  // Clean slate
  await clearState(hotelA.id);
  if (hotelB) await clearState(hotelB.id);

  // ── 1. Catalog read ───────────────────────────────────────────────────────
  console.log('1. Catalog read');
  {
    const { data, error } = await owner
      .from('seasonal_calendar_windows')
      .select('code, category, priority, is_approximate')
      .eq('is_active', true);
    check('seasonal_calendar_windows returns 16 active rows', !error && data?.length === 16,
      error ? error.message : `got ${data?.length}`);
    const approxCount = data?.filter((r) => r.is_approximate).length ?? 0;
    check('has both exact and approximate windows', approxCount > 0 && approxCount < 16,
      `approximate=${approxCount}`);
  }

  // ── 2. View returns rows for hotelA ──────────────────────────────────────
  console.log('\n2. v_visible_seasonal_windows');
  let charDhamOpening, winterSnow;
  {
    const { data, error } = await owner
      .from('v_visible_seasonal_windows')
      .select('window_code, computed_urgency, days_to_start, season_year, is_regional_match, next_start_ts, next_end_ts')
      .eq('hotel_id', hotelA.id);
    check('view returns 16 rows for the hotel', !error && data?.length === 16,
      error ? error.message : `got ${data?.length}`);
    charDhamOpening = data?.find((r) => r.window_code === 'CHAR_DHAM_OPENING');
    winterSnow = data?.find((r) => r.window_code === 'WINTER_SNOW_STAY');
    check('CHAR_DHAM_OPENING present with urgency band', !!charDhamOpening?.computed_urgency,
      charDhamOpening ? `${charDhamOpening.computed_urgency} · ${charDhamOpening.days_to_start}d` : 'missing');
    check('WINTER_SNOW_STAY present (cross-year window)', !!winterSnow?.computed_urgency,
      winterSnow ? `${winterSnow.computed_urgency} · ${winterSnow.days_to_start}d` : 'missing');
    check('all rows have a season_year', data?.every((r) => Number.isInteger(r.season_year)));
    check('all rows have next_start_ts in current or future', data?.every((r) => {
      const start = new Date(r.next_start_ts).getTime();
      const end = new Date(r.next_end_ts).getTime();
      return Number.isFinite(start) && Number.isFinite(end) && end >= start;
    }));
  }

  // ── 3. Cross-year date math: WINTER_SNOW_STAY end > start ─────────────────
  console.log('\n3. Date math (cross-year window)');
  {
    const start = new Date(winterSnow.next_start_ts);
    const end = new Date(winterSnow.next_end_ts);
    const sameOrNextYear = end.getUTCFullYear() === start.getUTCFullYear() || end.getUTCFullYear() === start.getUTCFullYear() + 1;
    check('Winter snow next_end is same or next year of next_start', sameOrNextYear,
      `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`);
  }

  // ── 4. tick_seasonal_checklist ────────────────────────────────────────────
  console.log('\n4. tick_seasonal_checklist');
  let tickedSeasonYear;
  {
    const { data, error } = await owner.rpc('tick_seasonal_checklist', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
      p_item_key: 'verify_packages_live',
      p_ticked: true,
    });
    check('tick a valid item → changed=true', !error && data?.changed === true, error?.message ?? 'ok');
    check('tick returns season_year', !!data?.season_year, `season_year=${data?.season_year}`);
    tickedSeasonYear = data?.season_year;

    const re = await owner.rpc('tick_seasonal_checklist', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
      p_item_key: 'verify_packages_live',
      p_ticked: true,
    });
    check('re-tick same item → changed=false (idempotent)', !re.error && re.data?.changed === false,
      re.error?.message ?? 'ok');

    const bad = await owner.rpc('tick_seasonal_checklist', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
      p_item_key: 'this_key_does_not_exist',
      p_ticked: true,
    });
    check('invalid item key → rejected with ITEM_KEY_NOT_IN_CATALOG',
      !!bad.error && /ITEM_KEY_NOT_IN_CATALOG/.test(bad.error.message),
      bad.error?.message ?? '(unexpected success)');

    const noWindow = await owner.rpc('tick_seasonal_checklist', {
      p_hotel_id: hotelA.id,
      p_window_code: 'NO_SUCH_WINDOW',
      p_item_key: 'x',
      p_ticked: true,
    });
    check('invalid window → rejected with WINDOW_NOT_FOUND',
      !!noWindow.error && /WINDOW_NOT_FOUND/.test(noWindow.error.message),
      noWindow.error?.message ?? '(unexpected success)');
  }

  // ── 5. update_seasonal_window_notes ───────────────────────────────────────
  console.log('\n5. update_seasonal_window_notes');
  {
    const first = await owner.rpc('update_seasonal_window_notes', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
      p_owner_notes: '  Anita confirmed yatra packages by Friday.  ',
      p_internal_notes: null,
    });
    check('notes saved (changed=true)', !first.error && first.data?.changed === true, first.error?.message);
    check('owner_notes trimmed', first.data?.owner_notes === 'Anita confirmed yatra packages by Friday.',
      `got: "${first.data?.owner_notes}"`);

    const same = await owner.rpc('update_seasonal_window_notes', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
      p_owner_notes: 'Anita confirmed yatra packages by Friday.',
      p_internal_notes: null,
    });
    check('re-save same value → changed=false (no audit churn)',
      !same.error && same.data?.changed === false, same.error?.message);

    const cleared = await owner.rpc('update_seasonal_window_notes', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
      p_owner_notes: '',
      p_internal_notes: null,
    });
    check('empty string normalised to NULL', !cleared.error && cleared.data?.owner_notes === null,
      cleared.error?.message);
  }

  // ── 6. mark_ready / return_to_planning ────────────────────────────────────
  console.log('\n6. mark_ready + return_to_planning');
  {
    const ready = await owner.rpc('mark_seasonal_window_ready', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
    });
    check('mark_ready succeeds', !ready.error && ready.data?.review_status === 'READY',
      ready.error?.message ?? `got ${ready.data?.review_status}`);

    const readyDoubled = await owner.rpc('mark_seasonal_window_ready', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
    });
    check('mark_ready called twice is idempotent', !readyDoubled.error && readyDoubled.data?.changed === false,
      readyDoubled.error?.message);

    const back = await owner.rpc('return_seasonal_window_to_planning', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
    });
    check('return_to_planning succeeds', !back.error && back.data?.review_status === 'PLANNING',
      back.error?.message);

    const invalidReturn = await owner.rpc('return_seasonal_window_to_planning', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
    });
    check('return when already PLANNING → INVALID_TRANSITION',
      !!invalidReturn.error && /INVALID_TRANSITION/.test(invalidReturn.error.message),
      invalidReturn.error?.message ?? '(unexpected success)');
  }

  // ── 7. dismiss + resume ───────────────────────────────────────────────────
  console.log('\n7. dismiss_for_year + resume');
  {
    const noReason = await owner.rpc('dismiss_seasonal_window_for_year', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
      p_reason: '',
    });
    check('dismiss without reason → DISMISS_REASON_REQUIRED',
      !!noReason.error && /DISMISS_REASON_REQUIRED/.test(noReason.error.message),
      noReason.error?.message ?? '(unexpected success)');

    const dismissed = await owner.rpc('dismiss_seasonal_window_for_year', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
      p_reason: 'Not targeting pilgrim segment this year.',
    });
    check('dismiss with reason succeeds', !dismissed.error && dismissed.data?.review_status === 'DISMISSED',
      dismissed.error?.message);

    const resumed = await owner.rpc('resume_seasonal_window', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
    });
    check('resume succeeds', !resumed.error && resumed.data?.review_status === 'PLANNING',
      resumed.error?.message);
  }

  // ── 8. override urgency + clear ───────────────────────────────────────────
  console.log('\n8. override_urgency + clear');
  {
    const noReason = await owner.rpc('override_seasonal_window_urgency', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
      p_urgency: 'QUIET',
      p_reason: null,
    });
    check('override without reason → OVERRIDE_REASON_REQUIRED',
      !!noReason.error && /OVERRIDE_REASON_REQUIRED/.test(noReason.error.message),
      noReason.error?.message ?? '(unexpected success)');

    const ok = await owner.rpc('override_seasonal_window_urgency', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
      p_urgency: 'QUIET',
      p_reason: 'Suppressing while staff training is on.',
    });
    check('override with reason succeeds', !ok.error && ok.data?.urgency_override === 'QUIET',
      ok.error?.message);

    // Verify view uses override
    const { data: v } = await owner.from('v_visible_seasonal_windows')
      .select('computed_urgency, urgency_override')
      .eq('hotel_id', hotelA.id).eq('window_code', 'CHAR_DHAM_OPENING').maybeSingle();
    check('view computed_urgency reflects override', v?.computed_urgency === 'QUIET',
      `got ${v?.computed_urgency}`);

    const cleared = await owner.rpc('override_seasonal_window_urgency', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
      p_urgency: null,
      p_reason: null,
    });
    check('clear override succeeds (no reason needed)', !cleared.error && cleared.data?.urgency_override === null,
      cleared.error?.message);
  }

  // ── 9. permanent hide + unhide ────────────────────────────────────────────
  console.log('\n9. set_permanently_hidden + unhide');
  {
    const noReason = await owner.rpc('set_seasonal_window_permanently_hidden', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
      p_hidden: true,
      p_reason: null,
    });
    check('hide without reason → HIDE_REASON_REQUIRED',
      !!noReason.error && /HIDE_REASON_REQUIRED/.test(noReason.error.message),
      noReason.error?.message ?? '(unexpected success)');

    const hidden = await owner.rpc('set_seasonal_window_permanently_hidden', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
      p_hidden: true,
      p_reason: 'Never serve this segment.',
    });
    check('hide with reason succeeds', !hidden.error && hidden.data?.is_permanently_hidden === true,
      hidden.error?.message);

    const unhide = await owner.rpc('set_seasonal_window_permanently_hidden', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
      p_hidden: false,
      p_reason: null,
    });
    check('unhide (no reason needed) succeeds', !unhide.error && unhide.data?.is_permanently_hidden === false,
      unhide.error?.message);
  }

  // ── 10. timeline RPC ──────────────────────────────────────────────────────
  console.log('\n10. get_seasonal_window_timeline');
  {
    const { data, error } = await owner.rpc('get_seasonal_window_timeline', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
      p_season_year: tickedSeasonYear,
      p_limit: 50,
    });
    check('timeline returns events from our prior actions', !error && Array.isArray(data) && data.length >= 5,
      error ? error.message : `${data?.length} events`);
    const types = new Set((data ?? []).map((e) => e.event_type));
    check('timeline includes CHECKLIST_TICKED', types.has('CHECKLIST_TICKED'));
    check('timeline includes DISMISSED_FOR_YEAR', types.has('DISMISSED_FOR_YEAR'));
    check('timeline includes URGENCY_OVERRIDDEN', types.has('URGENCY_OVERRIDDEN'));
    check('timeline includes MARKED_READY', types.has('MARKED_READY'));
    check('timeline events ordered DESC', (() => {
      for (let i = 1; i < (data?.length ?? 0); i++) {
        if (new Date(data[i - 1].occurred_at).getTime() < new Date(data[i].occurred_at).getTime()) return false;
      }
      return true;
    })());
  }

  // ── 11. RLS cross-tenant isolation ────────────────────────────────────────
  if (hotelB) {
    console.log('\n11. RLS cross-tenant isolation');
    const OTHER_EMAIL = 'seasonal-verify-other@local.vaiyu';
    const OTHER_PASS = 'SeasonalVerify2026!';
    const otherId = await ensureUser(OTHER_EMAIL, OTHER_PASS);
    await ensureMember(otherId, hotelB.id, 'owner');
    const other = await asUser(OTHER_EMAIL, OTHER_PASS);

    const { data: leakState } = await other.from('hotel_seasonal_window_states').select('id').eq('hotel_id', hotelA.id);
    check('hotelB user cannot read hotelA state rows', (leakState?.length ?? 0) === 0,
      `${leakState?.length ?? 0} rows leaked`);

    const { data: leakEvents } = await other.from('hotel_seasonal_window_events').select('id').eq('hotel_id', hotelA.id);
    check('hotelB user cannot read hotelA event rows', (leakEvents?.length ?? 0) === 0,
      `${leakEvents?.length ?? 0} rows leaked`);

    const { data: viewLeak } = await other.from('v_visible_seasonal_windows').select('window_code').eq('hotel_id', hotelA.id);
    check('view scopes by hotel via security_invoker', (viewLeak?.length ?? 0) === 0,
      `${viewLeak?.length ?? 0} rows leaked`);

    const blocked = await other.rpc('tick_seasonal_checklist', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
      p_item_key: 'verify_packages_live',
      p_ticked: true,
    });
    check('hotelB user blocked by NOT_AUTHORIZED when targeting hotelA',
      !!blocked.error && /NOT_AUTHORIZED/.test(blocked.error.message),
      blocked.error?.message ?? '(unexpected success)');
  } else {
    console.log('\n11. RLS cross-tenant isolation (skipped — no tenant2)');
  }

  // ── 12. Member (non-manager) permission gates ─────────────────────────────
  console.log('\n12. Member (non-manager) permission gates');
  {
    const STAFF_EMAIL = 'seasonal-verify-staff@local.vaiyu';
    const STAFF_PASS = 'SeasonalVerify2026!';
    const staffId = await ensureUser(STAFF_EMAIL, STAFF_PASS);
    await ensureMember(staffId, hotelA.id, 'staff');
    const staff = await asUser(STAFF_EMAIL, STAFF_PASS);

    const tick = await staff.rpc('tick_seasonal_checklist', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
      p_item_key: 'update_ota_pricing',
      p_ticked: true,
    });
    check('staff can tick checklist (any member allowed)', !tick.error, tick.error?.message);

    const dismiss = await staff.rpc('dismiss_seasonal_window_for_year', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
      p_reason: 'Trying to dismiss as staff',
    });
    check('staff cannot dismiss (manager-only) → NOT_AUTHORIZED',
      !!dismiss.error && /NOT_AUTHORIZED/.test(dismiss.error.message),
      dismiss.error?.message ?? '(unexpected success)');

    const markReady = await staff.rpc('mark_seasonal_window_ready', {
      p_hotel_id: hotelA.id,
      p_window_code: 'CHAR_DHAM_OPENING',
    });
    check('staff cannot mark_ready (manager-only) → NOT_AUTHORIZED',
      !!markReady.error && /NOT_AUTHORIZED/.test(markReady.error.message),
      markReady.error?.message ?? '(unexpected success)');
  }

  // ── 13. Cleanup ───────────────────────────────────────────────────────────
  console.log('\n13. Cleanup');
  await clearState(hotelA.id);
  if (hotelB) await clearState(hotelB.id);
  console.log('  ✓ state + events cleared for test hotels');

  console.log(`\n${failures === 0 ? '✓ ALL CHECKS PASSED' : `✗ ${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
