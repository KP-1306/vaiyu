-- Seed of default finance categories must not depend on the viewer's role.
--
-- finance_categories INSERT is finance-manager-only (RLS), but the seed runs
-- lazily on first visit to any finance screen — by whoever happens to open it.
-- As SECURITY INVOKER, a plain STAFF member being that first visitor on a
-- brand-new hotel hit "new row violates row-level security policy" and the
-- screen showed an error panel (reproduced 2026-06-12 on local).
--
-- Provisioning per-tenant defaults is a system concern, not a privileged
-- customization: run as SECURITY DEFINER, gated on active membership of the
-- target hotel (or platform admin) so outsiders cannot seed rows into another
-- tenant. Editing/deactivating categories stays finance-manager-only via RLS.

CREATE OR REPLACE FUNCTION public.seed_default_finance_categories(p_hotel_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (public.is_platform_admin() OR public.vaiyu_is_hotel_member(p_hotel_id)) THEN
    RAISE EXCEPTION 'Only active members of this hotel can seed finance categories'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.finance_categories (hotel_id, name, code, is_default)
  VALUES
    (p_hotel_id, 'Housekeeping',  'HK',   TRUE),
    (p_hotel_id, 'Maintenance',   'MAINT',TRUE),
    (p_hotel_id, 'Utilities',     'UTIL', TRUE),
    (p_hotel_id, 'F&B',           'FNB',  TRUE),
    (p_hotel_id, 'Staff',         'STAFF',TRUE),
    (p_hotel_id, 'Laundry',       'LAUN', TRUE),
    (p_hotel_id, 'Front Office',  'FO',   TRUE),
    (p_hotel_id, 'Marketing',     'MKT',  TRUE),
    (p_hotel_id, 'Miscellaneous', 'MISC', TRUE)
  ON CONFLICT (hotel_id, name) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_default_finance_categories(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_default_finance_categories(uuid) TO authenticated, service_role;
