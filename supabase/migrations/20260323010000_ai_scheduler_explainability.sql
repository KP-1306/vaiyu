-- =========================================================
-- AI EXPLAINABILITY & AUDIT TRAIL
-- =========================================================

-- 1. Extend audit table
alter table public.shift_audit_log
add column if not exists explanation jsonb;

-- Function moved to later migration for consolidation

-- 4. Update trg_shift_audit to capture 'explanation'
create or replace function public.trg_shift_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_changed_by uuid;
  v_hotel_id uuid;
  v_diff jsonb := '{}'::jsonb;
  v_explanation jsonb;
begin
  -- Read explanation from session
  v_explanation := nullif(
    current_setting('vaiyu.explanation', true),
    ''
  )::jsonb;

  -- 👤 Identify Actor
  v_changed_by := coalesce(
    current_setting('request.jwt.claim.sub', true)::uuid,
    auth.uid(),
    NEW.created_by,
    OLD.created_by
  );

  -- 🏢 Lookup hotel_id correctly
  select hm.hotel_id into v_hotel_id
  from public.hotel_members hm
  where hm.id = coalesce(NEW.staff_id, OLD.staff_id)
  limit 1;

  if v_hotel_id is null then
    raise exception 'Audit failed: hotel_id not found for staff %', coalesce(NEW.staff_id, OLD.staff_id);
  end if;

  if tg_op = 'INSERT' then
    v_action := 'created';
    v_diff := jsonb_build_object(
      'staff_id',      jsonb_build_object('new', NEW.staff_id),
      'department_id',  jsonb_build_object('new', NEW.department_id),
      'status',         jsonb_build_object('new', NEW.status),
      'shift_start',   jsonb_build_object('new', NEW.shift_start),
      'shift_end',     jsonb_build_object('new', NEW.shift_end),
      'shift_type',    jsonb_build_object('new', NEW.shift_type),
      'zone_id',       jsonb_build_object('new', NEW.zone_id)
    );
  elsif tg_op = 'UPDATE' then
    if (
      NEW.shift_start is not distinct from OLD.shift_start and
      NEW.shift_end is not distinct from OLD.shift_end and
      NEW.shift_type is not distinct from OLD.shift_type and
      NEW.zone_id is not distinct from OLD.zone_id and
      NEW.status is not distinct from OLD.status and
      NEW.staff_id is not distinct from OLD.staff_id and
      NEW.department_id is not distinct from OLD.department_id
    ) then
      return NEW;
    end if;

    v_action := 'updated';
    if NEW.shift_start is distinct from OLD.shift_start then v_diff := v_diff || jsonb_build_object('shift_start', jsonb_build_object('old', OLD.shift_start, 'new', NEW.shift_start)); end if;
    if NEW.shift_end is distinct from OLD.shift_end then v_diff := v_diff || jsonb_build_object('shift_end', jsonb_build_object('old', OLD.shift_end, 'new', NEW.shift_end)); end if;
    if NEW.department_id is distinct from OLD.department_id then v_diff := v_diff || jsonb_build_object('department_id', jsonb_build_object('old', OLD.department_id, 'new', NEW.department_id)); end if;
    if NEW.zone_id is distinct from OLD.zone_id then v_diff := v_diff || jsonb_build_object('zone_id', jsonb_build_object('old', OLD.zone_id, 'new', NEW.zone_id)); end if;
    if NEW.status is distinct from OLD.status then v_diff := v_diff || jsonb_build_object('status', jsonb_build_object('old', OLD.status, 'new', NEW.status)); end if;
  
  elsif tg_op = 'DELETE' then
    v_action := 'deleted';
    v_diff := jsonb_build_object(
      'deleted', true,
      'department_id', OLD.department_id,
      'staff_id', OLD.staff_id,
      'shift_start', OLD.shift_start,
      'shift_end', OLD.shift_end
    );
    -- Insert audit log for delete before returning OLD
    insert into public.shift_audit_log (
      hotel_id, shift_id, staff_id, action, diff, 
      action_reason, explanation, changed_by
    )
    values (
      v_hotel_id, OLD.id, OLD.staff_id, v_action, v_diff, 
      nullif(current_setting('vaiyu.action_reason', true), ''),
      v_explanation,
      v_changed_by
    );
    return OLD;
  end if;

  -- 💾 Insert audit log for insert/update
  insert into public.shift_audit_log (
    hotel_id, shift_id, staff_id, action, diff, 
    action_reason, explanation, changed_by
  )
  values (
    v_hotel_id, NEW.id, NEW.staff_id, v_action, v_diff, 
    nullif(current_setting('vaiyu.action_reason', true), ''),
    v_explanation,
    v_changed_by
  );

  return NEW;
end;
$$;

alter function public.trg_shift_audit() owner to postgres;

-- bulk_assign_shifts moved to later migration for consolidation
