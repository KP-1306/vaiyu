-- =========================================================
-- DRY RUN VALIDATION ARCHITECTURE
-- =========================================================

-- 1. Redefine assign_shift to accept p_dry_run
drop function if exists public.assign_shift(uuid, timestamptz, timestamptz, text, uuid, uuid, uuid, text, jsonb);

create or replace function public.assign_shift(
  p_staff_id uuid,
  p_shift_start timestamptz,
  p_shift_end timestamptz,
  p_shift_type text,
  p_zone_id uuid,
  p_created_by uuid,
  p_department_id uuid default null,
  p_action_reason text default null,
  p_explanation jsonb default null,
  p_dry_run boolean default false
)
returns uuid
language plpgsql
as $$
declare 
  v_id uuid;
  v_dept_id uuid := p_department_id;
begin
  -- 🛡 1. SECURITY: Strong multi-role safe hotel membership check
  if not exists (
    select 1
    from public.hotel_members hm_staff
    join public.hotel_members hm_user
      on hm_staff.hotel_id = hm_user.hotel_id
    where hm_staff.id = p_staff_id
      and hm_user.user_id = auth.uid()
      and hm_user.is_active = true
      and hm_staff.is_active = true
  ) then
    raise exception 'Unauthorized or invalid active hotel membership context';
  end if;

  -- 🔄 2. CONCURRENCY: Lock the staff member
  perform 1
  from public.hotel_members
  where id = p_staff_id
  for update;

  -- 🧩 3. INTEGRITY: Zone-to-Department enforcement
  if v_dept_id is null and p_zone_id is not null then
    select department_id into v_dept_id
    from public.hotel_zones
    where id = p_zone_id;
  end if;

  if v_dept_id is null then
    -- 🎯 3B: Fallback to PRIMARY department
    select department_id into v_dept_id
    from public.staff_departments
    where staff_id = p_staff_id
      and is_primary = true
      and is_active = true
    limit 1;
  end if;

  if v_dept_id is null then
    -- 🎯 3C: Final Fallback to ANY active department (Safety)
    select department_id into v_dept_id
    from public.staff_departments
    where staff_id = p_staff_id
      and is_active = true
    order by priority desc, department_id asc
    limit 1;
  end if;

  -- 🛡 3D: Hard Assertion before INSERT
  if v_dept_id is null then
    raise exception 'Validation failed: Staff member has no active department assignments';
  end if;

  -- 📝 4. AUDIT CONTEXT: Pass reasoning securely to trigger layer
  perform set_config(
    'vaiyu.action_reason',
    coalesce(p_action_reason, 'Manual assignment'),
    true
  );

  perform set_config(
    'vaiyu.explanation',
    coalesce(p_explanation::text, ''),
    true
  );

  -- 💾 5. EXECUTION: Insert the active shift
  insert into public.staff_shifts (
    staff_id,
    shift_start,
    shift_end,
    shift_type,
    zone_id,
    department_id,
    created_by,
    is_active,
    status
  )
  values (
    p_staff_id,
    p_shift_start,
    p_shift_end,
    p_shift_type::shift_type_enum,
    p_zone_id,
    v_dept_id,
    p_created_by,
    true,
    'scheduled'
  )
  returning id into v_id;

  -- 🧹 6. CLEANUP: Prevent session leak
  perform set_config('vaiyu.action_reason', '', true);
  perform set_config('vaiyu.explanation', '', true);

  -- 🛑 7. DRY RUN ABORT: Cancel the entire transaction safely, but prove success constraints passed
  if p_dry_run then
    raise exception 'DRY_RUN_SUCCESS';
  end if;

  return v_id;
end;
$$;


-- 2. Redefine bulk_assign_shifts to accept p_dry_run and execute Subtransactions
drop function if exists public.bulk_assign_shifts(jsonb, uuid);

create or replace function public.bulk_assign_shifts(
  p_shifts jsonb,
  p_user uuid,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
as $$
declare
  v_item jsonb;
  v_result jsonb := '[]'::jsonb;
  v_shift_id uuid;
begin
  for v_item in select * from jsonb_array_elements(p_shifts)
  loop
    begin
      -- Standardize logic via core engine
      v_shift_id := public.assign_shift(
        (v_item->>'staff_id')::uuid,
        (v_item->>'shift_start')::timestamptz,
        (v_item->>'shift_end')::timestamptz,
        v_item->>'shift_type',
        (v_item->>'zone_id')::uuid,
        p_user,
        (v_item->>'department_id')::uuid,
        nullif(v_item->>'action_reason', ''),
        (v_item->'explanation')::jsonb,
        p_dry_run -- Pass dry run constraint
      );

      -- If we reach here, p_dry_run=false AND execution was successful.
      v_result := v_result || jsonb_build_object(
        'staff_id', v_item->>'staff_id',
        'shift_start', v_item->>'shift_start',
        'shift_end', v_item->>'shift_end',
        'status', 'success',
        'message', 'Clear',
        'shift_id', v_shift_id
      );

    exception
      when raise_exception then
        if sqlerrm = 'DRY_RUN_SUCCESS' then
          -- The transaction was intentionally rolled back by the engine to simulate dryness
          v_result := v_result || jsonb_build_object(
            'staff_id', v_item->>'staff_id',
            'shift_start', v_item->>'shift_start',
            'shift_end', v_item->>'shift_end',
            'status', 'success',
            'message', 'Clear'
          );
        else
          v_result := v_result || jsonb_build_object(
            'staff_id', v_item->>'staff_id',
            'shift_start', v_item->>'shift_start',
            'shift_end', v_item->>'shift_end',
            'status', 'error',
            'message', SQLERRM
          );
        end if;
      when exclusion_violation then
        v_result := v_result || jsonb_build_object(
          'staff_id', v_item->>'staff_id',
          'shift_start', v_item->>'shift_start',
          'shift_end', v_item->>'shift_end',
          'status', 'conflict',
          'message', 'Overlaps with an existing shift'
        );
      when others then
        v_result := v_result || jsonb_build_object(
          'staff_id', v_item->>'staff_id',
          'shift_start', v_item->>'shift_start',
          'shift_end', v_item->>'shift_end',
          'status', 'error',
          'message', SQLERRM
        );
    end;
  end loop;

  return v_result;
end;
$$;
