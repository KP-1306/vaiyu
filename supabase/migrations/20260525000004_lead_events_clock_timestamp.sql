-- Lead events: use clock_timestamp() not now() for occurred_at
--
-- Bug caught during Day 2 smoke testing: now() returns transaction-start
-- time, so multiple events written within one RPC (e.g. transition_lead_status
-- writes both STATUS_CHANGED + REOPENED on LOST→NEW) end up with identical
-- occurred_at values. ORDER BY occurred_at DESC cannot tie-break, and the
-- timeline UI renders events in unpredictable order.
--
-- Fix: switch the column default to clock_timestamp(), which returns the
-- actual statement execution time and gives microsecond-level ordering even
-- for inserts inside the same RPC / transaction.

ALTER TABLE public.lead_events
  ALTER COLUMN occurred_at SET DEFAULT clock_timestamp();

COMMENT ON COLUMN public.lead_events.occurred_at IS
  'Statement-level timestamp (clock_timestamp), not transaction-level (now()). Ensures distinct ordering for multiple events written within a single RPC call.';
