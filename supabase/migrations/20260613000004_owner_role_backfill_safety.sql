-- Safety re-run of the owner-role creation + M2M backfill from
-- 20260613000002 (steps 5a + 5b).
--
-- WHY: 20260613000002 was pushed to prod mid-development. Its step 5a (create a
-- canonical 'OWNER' role for hotels that have active owner members but no
-- owner-tier role, so the backfill can complete) was ADDED after the file was
-- first authored. Because prod's migration ledger already records version
-- ...000002, re-pushing the edited file is a no-op (version match → skip). This
-- standalone migration re-applies just those two idempotent steps so prod is
-- guaranteed complete (residual owners-without-M2M = 0). Fully idempotent — a
-- no-op if 5a/5b already ran.

-- 5a — create the canonical 'OWNER' role for hotels that have active legacy
--      'owner' members but no owner-tier role at all. UNIQUE(hotel_id, code).
INSERT INTO public.hotel_roles (hotel_id, code, name, is_active)
SELECT DISTINCT hm.hotel_id, 'OWNER', 'Owner', true
FROM public.hotel_members hm
WHERE hm.is_active = true
  AND lower(hm.role) = 'owner'
  AND NOT EXISTS (
    SELECT 1 FROM public.hotel_member_roles x WHERE x.hotel_member_id = hm.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.hotel_roles r
    WHERE r.hotel_id = hm.hotel_id AND upper(r.code) IN ('OWNER', 'OWNER_0', 'HOTEL_OWNER')
  )
ON CONFLICT (hotel_id, code) DO NOTHING;

-- 5b — backfill the M2M source of truth for active legacy 'owner' members with
--      no M2M role row, attaching their hotel's owner role (guaranteed by 5a).
INSERT INTO public.hotel_member_roles (hotel_member_id, role_id)
SELECT hm.id, hr.id
FROM public.hotel_members hm
JOIN LATERAL (
    SELECT r.id
    FROM public.hotel_roles r
    WHERE r.hotel_id = hm.hotel_id
      AND upper(r.code) IN ('OWNER', 'OWNER_0', 'HOTEL_OWNER')
    ORDER BY (upper(r.code) <> 'OWNER')   -- prefer the exact 'OWNER' code
    LIMIT 1
) hr ON true
WHERE hm.is_active = true
  AND lower(hm.role) = 'owner'
  AND NOT EXISTS (
    SELECT 1 FROM public.hotel_member_roles x WHERE x.hotel_member_id = hm.id
  )
ON CONFLICT DO NOTHING;
