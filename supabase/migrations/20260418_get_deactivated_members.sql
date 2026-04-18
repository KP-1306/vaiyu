-- =========================================================
-- RPC: Get Deactivated Hotel Members (Bypasses RLS)
-- =========================================================

CREATE OR REPLACE FUNCTION get_deactivated_hotel_members(
  p_hotel_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Auth check: ensure caller is an active OWNER/ADMIN/MANAGER of this hotel
  IF NOT EXISTS (
    SELECT 1 FROM public.hotel_members hm
    JOIN public.hotel_member_roles hmr ON hmr.hotel_member_id = hm.id
    JOIN public.hotel_roles hr ON hr.id = hmr.role_id
    WHERE hm.user_id = auth.uid()
      AND hm.hotel_id = p_hotel_id
      AND (hr.code LIKE 'OWNER%' OR hr.code LIKE 'ADMIN%' OR hr.code LIKE 'MANAGER%')
      AND hm.is_active = true
  ) THEN
    RAISE EXCEPTION 'Not authorized to view deactivated members';
  END IF;

  RETURN COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'staff_id', hm.id,
        'full_name', COALESCE(p.full_name, p.email, 'Unknown User'),
        'email', p.email,
        'avatar_url', p.profile_photo_url,
        'is_active', hm.is_active,
        'is_verified', hm.is_verified,
        'department_name', d.name,
        'roles', (
          SELECT string_agg(hr.name, ', ')
          FROM public.hotel_member_roles hmr
          JOIN public.hotel_roles hr ON hr.id = hmr.role_id
          WHERE hmr.hotel_member_id = hm.id
        )
      ) ORDER BY p.full_name
    )
    FROM public.hotel_members hm
    LEFT JOIN public.profiles p ON p.id = hm.user_id
    LEFT JOIN public.departments d ON d.id = hm.department_id
    WHERE hm.hotel_id = p_hotel_id
      AND hm.is_active = false
    ),
    '[]'::jsonb
  );
END;
$$;
