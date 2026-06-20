-- ============================================================
-- VAiyu WRITE-PATH AUDIT (5/5): cross-tenant / unused open INSERT policies
-- ============================================================
-- FINDING (class B/C): four tables carried INSERT policies open to anon or any
-- authenticated user (WITH CHECK true) with NO tenancy scope. Because ANY guest
-- can self-signup and obtain an `authenticated` JWT, an "authenticated CHECK(true)
-- INSERT" is effectively open to the internet + 1 signup, and is cross-tenant
-- (writes into any hotel). For all four, the legitimate write path does NOT use
-- these policies:
--
--   chat_threads      — all client writes go through SECURITY DEFINER RPCs
--                       (send_chat_message / assign_chat_thread / ...). The app
--                       reads via v_chat_threads + wa_chat_threads realtime, never
--                       a direct .insert. The "chat_threads_insert_auth" policy
--                       has no caller. → DROP.
--   checkin_events    — written only inside SECURITY DEFINER walk-in/check-in
--                       RPCs (create_walkin_v2/v3, submit_precheckin, checkout_stay),
--                       which bypass RLS as owner. The anon + authenticated
--                       CHECK(true) INSERT policies have no client caller. → DROP
--                       (keep checkin_events_insert_service for service_role).
--   checkin_sessions  — no web/src or edge client writes it; SD RPCs cover the
--                       inserts. → DROP the anon INSERT (keep checkin_sessions_staff_all
--                       + the SD path).
--   ticket_attachments— no app writer at all today; the authenticated CHECK(true)
--                       INSERT let any signed-up user attach a file to ANY hotel's
--                       ticket. → SCOPE the INSERT to tickets the caller can see,
--                       mirroring the proven read policy "ta read via visible
--                       ticket" (the EXISTS(tickets) subquery is filtered by
--                       tickets' own member-scoped RLS, so a non-member sees no
--                       row and the CHECK fails). Correct posture if a writer is
--                       wired later.
--
-- All SECURITY DEFINER writer RPCs were confirmed prosecdef=true, so they bypass
-- RLS and are unaffected by these drops. Idempotent.
-- ============================================================

-- ── chat_threads: drop unused cross-tenant authenticated INSERT ────────────
DROP POLICY IF EXISTS "chat_threads_insert_auth" ON public.chat_threads;

-- ── checkin_events: drop unused anon + authenticated CHECK(true) INSERT ─────
DROP POLICY IF EXISTS "Anon can log events"         ON public.checkin_events;
DROP POLICY IF EXISTS "Staff/System can log events" ON public.checkin_events;

-- ── checkin_sessions: drop unused anon INSERT ──────────────────────────────
DROP POLICY IF EXISTS "Anon can create checkin sessions" ON public.checkin_sessions;

-- ── ticket_attachments: scope INSERT to a ticket the caller can see ────────
DROP POLICY IF EXISTS "Authenticated users can upload attachments" ON public.ticket_attachments;
CREATE POLICY "ta insert via visible ticket"
  ON public.ticket_attachments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.id = ticket_attachments.ticket_id
    )
  );
