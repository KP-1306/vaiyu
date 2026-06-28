# Postmortem — Kitchen & Supervisor boards timing out (57014)

**Date:** 2026-06-28
**Severity:** High (operational boards unusable on prod)
**Area:** Postgres views — `security_invoker` setting
**Status:** Fixed + verified on prod

> This is about the **`security_invoker` view setting** — NOT the API-key
> migration. Both happened around the same time; they are unrelated.

---

## TL;DR

A blanket migration on **2026-06-20** flipped a set of database views from
definer-rights to `security_invoker = true`. For the heavy, self-guarded views
that power the **kitchen board** and **supervisor (`/ops`) board**, that flip made
Postgres re-plan all underlying RLS on *every* request, pushing them past the 8s
statement timeout → `57014 canceling statement due to statement timeout`. Boards
wouldn't load / cards wouldn't move. Fixed by restoring definer-rights on the
affected views.

---

## What broke (symptom)

- **Kitchen board:** after ACCEPT, the card stayed stuck in NEW; console showed
  `57014` on `v_my_food_orders` / `v_runner_queue`.
- **Supervisor `/ops` board:** `500` + `57014` on `v_ops_board_tickets`; board
  wouldn't populate; the rooms fetch timed out as collateral (DB CPU saturated).

---

## Root cause

1. On **2026-06-19**, these views were deliberately created
   `security_invoker = false` (definer-rights) **with a self-filtering guard** on
   the outer query — `WHERE vaiyu_is_hotel_member(hotel_id)` (or
   `vaiyu_can_view_hotel_analytics(hotel_id)` for the manager-tier analytics
   views). Definer + guard = fast **and** tenant-safe by design.

2. On **2026-06-20**, migration `20260620000016_security_invoker_views_tier_c.sql`
   ran a blanket loop flipping **every** authenticated-readable definer view to
   `security_invoker = true`. Its "leave self-filtering views alone" exclusion was:

   ```sql
   pg_get_viewdef(...) !~* '(current_guest_id|auth\.uid)'
   ```

   That regex scans the **view text**. The guard on these views is a **function
   wrapper** — `vaiyu_is_hotel_member()` — whose `auth.uid()` call lives *inside
   the function*, not in the view text. So the regex didn't match, and the loop
   flipped these views **against its own stated intent**.

3. Under `security_invoker = true`, the planner re-expands every underlying-table
   RLS policy into a deeply-nested subplan tree on **every** request.

   | | Planning time | Subplans |
   |---|---|---|
   | `security_invoker = true` (the flip) | **~257 ms** | 211 |
   | `security_invoker = false` (definer)  | **~1.2 ms** | 1 |

   The kitchen and ops boards each read **4–5** of these views *and* re-fire on
   every realtime event (an ACCEPT emits several). The planning cost stacks past
   `statement_timeout = 8s` → `57014`.

---

## The fix (deployed + verified on prod)

Restored `security_invoker = false` on the affected, self-guarded views:

- **5 kitchen views** — migration `20260628000001`
  (`v_kitchen_queue`, `v_my_food_orders`, `v_runner_queue`, `v_active_checkins`,
  `v_housekeeping_operational_board`).
- **15 ops board + analytics views** — migration `20260628000002`
  (8 member-tier board/drawers guarded by `vaiyu_is_hotel_member`; 7 manager-tier
  analytics guarded by `vaiyu_can_view_hotel_analytics`).

Verified on prod:
- Cross-tenant isolation holds — a member sees only their hotel's rows; a
  different-hotel member sees 0; anon = `permission denied` (no grant).
- Planning dropped **257 ms → ~8 ms**.

---

## Rules going forward (please apply to any future view sweep)

1. **Any blanket "flip definer → `security_invoker`" sweep must treat
   `vaiyu_is_hotel_member(...)`- and `vaiyu_can_view_hotel_analytics(...)`-guarded
   views as self-filtering** — i.e., skip them, exactly like the
   `current_guest_id()/auth.uid()` exclusion already does. A function-wrapper
   guard will **not** show up in a `pg_get_viewdef` text match, so match on the
   guard function names too.

2. **Don't blanket-flip in either direction.** The reverse is also dangerous: the
   `v_owner_*` analytics views are **intentionally** `security_invoker = true` —
   they were made invoker on **2026-06-16** (`20260616000006`) to seal a proven
   cross-tenant leak (anon could read 4 hotels). Flipping those to definer would
   re-open a P0.

3. **When changing a view's rights, check two things:**
   (a) Does it carry an **outer** self-filtering guard?
   (b) What's its **planning cost**, and is it on a **realtime/interactive hot
   path**?
   Flip to definer only when it's self-guarded **and** heavy + hot. Otherwise
   leave it as-is.

---

## Reference — how to audit before any future sweep

```sql
-- planning cost + guard, per view, as the authenticated role:
--   high planning (≥~250ms) + a vaiyu_* guard + on a hot path  -> wants definer
--   no guard                                                   -> MUST stay invoker
--   v_owner_* / per-staff (v_staff_runner_tickets)             -> leave invoker
select c.relname,
       (select option_value from pg_options_to_table(c.reloptions)
         where option_name='security_invoker') as security_invoker,
       case when pg_get_viewdef(c.oid) ~* 'vaiyu_is_hotel_member' then 'member'
            when pg_get_viewdef(c.oid) ~* 'vaiyu_can_view_hotel_analytics' then 'analytics'
            when pg_get_viewdef(c.oid) ~* 'current_guest_id|auth\.uid' then 'self-uid'
            else 'NO-GUARD (must stay invoker)' end as guard
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='v'
order by guard, c.relname;
```
