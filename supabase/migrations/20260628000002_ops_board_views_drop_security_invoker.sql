-- Restore definer-rights on the ops board/drawer + ops-analytics views that were
-- collaterally flipped to security_invoker, which timed the supervisor board
-- (/ops) and the ops-manager dashboard (/ops/analytics) out on prod.
--
-- Symptom (prod, observed in the front-desk console on /ops?slug=tenant1):
--   GET /rest/v1/v_ops_board_tickets 500
--   [listTickets] Supabase error {code:'57014', message:'canceling statement due
--   to statement timeout'} -> board never populates; the rooms fetch times out as
--   collateral (DB CPU saturated) and the /tickets,/rooms edge-fn fallbacks (which
--   read the same view/table) then 400. Same 57014 family already fixed for the
--   kitchen board in 20260628000001.
--
-- Root cause (same mechanism as 20260628000001, kitchen):
--   These views are security_invoker=true. That forces the planner to re-expand
--   every underlying-table RLS policy (tickets, ticket_sla_state, services,
--   departments, rooms, hotel_members, profiles, ...) into a deeply-nested subplan
--   tree on EVERY request. The /ops board reads v_ops_board_tickets plus the
--   at-risk / agent-risk / blocked drawers, and re-fires on each realtime ticket
--   event, so the per-request planning cost stacks past statement_timeout=8s
--   (57014). For a logged-in user the role is `authenticated` regardless of legacy
--   anon key vs new sb_publishable_ key, so the 2026-06-26 API-key migration does
--   not cause this.
--
-- How they regressed (NOT the API-key migration):
--   * 2026-06-19 DELIBERATELY created BOTH families WITH (security_invoker = false)
--     for performance + a self-filtering guard, and each migration's header says
--     so explicitly:
--       - 20260619000001 made the 7 ops-ANALYTICS views definer because
--         security_invoker "=> HTTP 500 on load"; each carries an OUTER
--         WHERE ... vaiyu_can_view_hotel_analytics(hotel_id) guard (manager tier).
--       - 20260619000002 made the 8 ops-BOARD/DRAWER views definer and scoped them
--         to MEMBER tier: "these are front-line staff operational screens (the ops
--         board/drawers), so any active member of the hotel may see their own
--         hotel's data; never another hotel's, never anon." Each carries an OUTER
--         WHERE ... vaiyu_is_hotel_member(hotel_id) guard.
--   * 2026-06-20 (20260620000016) ran a blanket loop flipping every
--     authenticated-readable definer view to security_invoker=true. Its
--     "leave self-filtering views alone" exclusion was
--       pg_get_viewdef(...) !~* '(current_guest_id|auth\.uid)'
--     which does NOT match the vaiyu_is_hotel_member()/vaiyu_can_view_hotel_analytics()
--     WRAPPERS (their auth.uid() lives inside the function, not the view text). So
--     the loop flipped both ops families against their own stated intent, re-
--     introducing the exact 500 that 20260619000001 had just fixed.
--
-- Why dropping security_invoker is SAFE here (proven per-view, not assumed):
--   (a) anon has NO SELECT on any of these 15 views (verified) -> not publicly
--       exposable regardless of view rights.
--   (b) every one of these 15 carries a self-filtering guard on its OUTER query
--       (verified via pg_get_viewdef): MEMBER-tier views end in
--       `WHERE ... vaiyu_is_hotel_member(hotel_id)`; ANALYTICS-tier views end in
--       `WHERE ... vaiyu_can_view_hotel_analytics(hotel_id)`. Both guard functions
--       are SECURITY DEFINER reading auth.uid() from the request JWT, so the caller
--       only ever sees rows for hotels they belong to (member) / may analyse
--       (manager) -- even though the view body runs with definer rights. Verified
--       on local: a member sees identical rows invoker-vs-definer; a different-
--       hotel member and anon see 0.
--   (c) restoring definer restores the INTENDED 2026-06-19 visibility model. The
--       ops board is a hotel-level operational cockpit (any member sees the hotel's
--       queue, by design); the per-staff `tickets` RLS
--       (staff_can_see_assigned_and_unassigned_tickets) protects the PERSONAL task
--       surfaces (Desk queue, v_staff_runner_tickets), not the shared ops board.
--       listTickets() consumes v_ops_board_tickets with a hotel_id filter only (no
--       per-staff filter), confirming hotel-level intent.
--
-- DELIBERATELY NOT FLIPPED (stay security_invoker=true):
--   v_ops_kpi_current, v_ops_backlog_trend, v_ops_created_resolved_30d,
--   v_ops_exception_reasons_30d, v_ops_sla_breach_reasons. These have NO in-view
--   tenant guard at all, so security_invoker=true (caller's RLS applies) is their
--   CORRECT safe state -- dropping it would expose every tenant's rows to any
--   authenticated member. They are also not referenced by the frontend, so their
--   invoker planning cost is not on any hot path. Leaving them invoker is correct,
--   not a deferral. (If one ever becomes frontend-consumed and slow, the fix is to
--   ADD an outer hotel guard THEN flip to definer -- never a blind flip.)
--
-- DURABILITY: any future blanket "flip definer views to security_invoker" sweep
-- MUST treat vaiyu_is_hotel_member(...)- and vaiyu_can_view_hotel_analytics(...)-
-- guarded views as self-filtering (same as the current_guest_id()/auth.uid()
-- exclusion) or it will silently re-break this.

-- ── Member-tier ops board + drawers (20260619000002, vaiyu_is_hotel_member) ──────
alter view if exists public.v_ops_board_tickets                     set (security_invoker = false);
alter view if exists public.v_ops_at_risk_details                   set (security_invoker = false);
alter view if exists public.v_ops_agent_risk_details                set (security_invoker = false);
alter view if exists public.v_ops_blocked_tickets_detail            set (security_invoker = false);
alter view if exists public.v_ops_sla_breaches_by_dept              set (security_invoker = false);
alter view if exists public.v_ops_sla_exception_details             set (security_invoker = false);
alter view if exists public.v_ops_sla_exception_decisions_by_reason set (security_invoker = false);
alter view if exists public.v_ops_sla_exceptions_by_department      set (security_invoker = false);

-- ── Manager-tier ops analytics (20260619000001, vaiyu_can_view_hotel_analytics) ──
alter view if exists public.v_ops_agent_risk                        set (security_invoker = false);
alter view if exists public.v_ops_at_risk_departments               set (security_invoker = false);
alter view if exists public.v_ops_open_breaches                     set (security_invoker = false);
alter view if exists public.v_ops_blocked_stagnation_risk           set (security_invoker = false);
alter view if exists public.v_ops_exceptions_30d                    set (security_invoker = false);
alter view if exists public.v_ops_decisions_30d                     set (security_invoker = false);
alter view if exists public.v_ops_ticket_backlog_30d                set (security_invoker = false);
