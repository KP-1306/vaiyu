-- =========================================================
-- 🧠 VAIYU WORKFORCE EVOLUTION: DEPARTMENT-AWARE SHIFTS
-- =========================================================

BEGIN;

-- 🛡 0: Create strict Shift Type Enum
do $$
begin
  if not exists (select 1 from pg_type where typname = 'shift_type_enum') then
    create type shift_type_enum as enum ('morning', 'evening', 'night');
  end if;
end $$;

-- =========================================================
-- STEP 1: Extend staff_departments (The Capability Layer)
-- ===================================-- =========================================

alter table public.staff_departments
add column if not exists is_primary boolean not null default false,
add column if not exists priority int default 1,
add column if not exists is_active boolean not null default true,
add column if not exists effective_from timestamptz not null default now(),
add column if not exists created_at timestamptz not null default now();

-- 🛡 Unique Constraint: Only one primary department per staff
create unique index if not exists uniq_primary_department_per_staff
on public.staff_departments (staff_id)
where is_primary = true;

-- =========================================================
-- STEP 2: Add department_id to staff_shifts (The Execution Layer)
-- =========================================================

alter table public.staff_shifts
add column if not exists department_id uuid;

-- =========================================================
-- STEP 3: Deterministic Backfill (Safety First)
-- =========================================================

-- 🎯 3A: Populate from PRIMARY department
update public.staff_shifts s
set department_id = sd.department_id
from public.staff_departments sd
where s.staff_id = sd.staff_id
  and sd.is_primary = true
  and s.department_id is null;

-- 🎯 3B: Fallback (Deterministic Tie-Breaker)
-- Pick highest priority, then deterministic department_id
update public.staff_shifts s
set department_id = sd.department_id
from (
  select distinct on (staff_id)
    staff_id,
    department_id
  from public.staff_departments
  order by staff_id, priority desc, department_id asc
) sd
where s.staff_id = sd.staff_id
  and s.department_id is null;

-- 🛡 3C: Safety Assertion (Prevent migration failure)
do $$
begin
  if exists (
    select 1 from public.staff_shifts where department_id is null
  ) then
    raise exception 'Migration abort: Some shifts could not be mapped to a department. Check staff_departments mapping.';
  end if;
end $$;

-- 🛡 3D: Status & Type Validation
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_shifts_status_enum_check') then
    alter table public.staff_shifts
    add constraint staff_shifts_status_enum_check
    check (status in ('scheduled','in_progress','completed','cancelled'));
  end if;
end $$;

-- 🏗 Migrate to strict enum (Handle view dependencies)
drop view if exists public.v_staff_shifts_active cascade;
drop view if exists public.v_staff_shift_board cascade;

-- 🛡 DROP old text-based check constraint before type migration
-- (Otherwise alteration fails due to enum-text comparison 42883)
alter table public.staff_shifts
drop constraint if exists staff_shifts_shift_type_check;

alter table public.staff_shifts 
alter column shift_type type shift_type_enum 
using shift_type::shift_type_enum;

-- 🏗 Recreate dependent view: v_staff_shifts_active
create or replace view public.v_staff_shifts_active as
select
  id,
  staff_id,
  shift_start,
  shift_end,
  is_active,
  created_at,
  updated_at,
  zone_id,
  shift_type,
  status,
  created_by,
  cancelled_at,
  version,
  locked_at,
  locked_by,
  case
    when locked_at is not null
    and locked_at > (now() - '00:05:00'::interval) then true
    else false
  end as is_actively_locked
from
  staff_shifts;

-- 🏗 Recreate dependent view: v_staff_shift_board (Initial baseline)
-- Note: A more refined version of this view is created later in STEP 5C
create or replace view public.v_staff_shift_board as
select
  ss.id as shift_id,
  ss.staff_id,
  p.full_name,
  ss.shift_start,
  ss.shift_end,
  ss.shift_type,
  ss.status,
  ss.zone_id,
  z.name as zone_name,
  ss.department_id,
  d.name as department_name,
  ss.version
from public.staff_shifts ss
join public.hotel_members hm on hm.id = ss.staff_id
left join public.profiles p on p.id = hm.user_id
left join public.hotel_zones z on z.id = ss.zone_id
left join public.departments d on d.id = ss.department_id
where ss.is_active = true;

-- 🛡 STEP 4: Enforce Constraints & Indexes (IDEMPOTENT)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_shifts_department_id_not_null') then
    alter table public.staff_shifts
    add constraint staff_shifts_department_id_not_null
    check (department_id is not null) not valid;
    
    alter table public.staff_shifts
    validate constraint staff_shifts_department_id_not_null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'staff_shifts_department_id_fkey') then
    alter table public.staff_shifts
    add constraint staff_shifts_department_id_fkey
    foreign key (department_id)
    references public.departments(id)
    on delete restrict;
  end if;
end $$;

create index if not exists idx_shifts_department
on public.staff_shifts (department_id);

create index if not exists idx_shifts_staff_department
on public.staff_shifts (staff_id, department_id);

-- 🚀 PRODUCTION PERFORMANCE INDEXES
create index if not exists idx_shift_staff_time
on public.staff_shifts (staff_id, shift_start, shift_end);

create index if not exists idx_shift_department_time
on public.staff_shifts (department_id, shift_start);

-- =========================================================
-- STEP 5: Hardened RPCs (Department-Aware Logic)
-- =========================================================

-- 🔗 5A & 5B moved to later migrations for consolidation
-- 🔗 5C: Refined Views (DEFENSIVE & OPTIMIZED)
create or replace view public.v_staff_shift_board as
select
  ss.id as shift_id,
  ss.staff_id,
  p.full_name,
  ss.shift_start,
  ss.shift_end,
  ss.shift_type,
  ss.status,
  ss.zone_id,
  z.name as zone_name,
  ss.department_id,
  coalesce(d.name, 'Unknown') as department_name,
  ss.version
from public.staff_shifts ss
join public.hotel_members hm on hm.id = ss.staff_id
left join public.profiles p on p.id = hm.user_id
left join public.hotel_zones z on z.id = ss.zone_id
left join public.departments d on d.id = ss.department_id
where ss.is_active = true;

-- 🔗 5D: AUDIT TRIGGER UPDATE (Strict logic + DELETE support)
create or replace function public.trg_shift_audit()
returns trigger
language plpgsql
as $$
declare
  v_action text;
  v_changed_by uuid;
  v_hotel_id uuid;
  v_diff jsonb := '{}'::jsonb;
begin
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
      action_reason, changed_by
    )
    values (
      v_hotel_id, OLD.id, OLD.staff_id, v_action, v_diff, 
      nullif(current_setting('vaiyu.action_reason', true), ''),
      v_changed_by
    );
    
    return OLD;
  end if;

  insert into public.shift_audit_log (
    hotel_id, shift_id, staff_id, action, diff, 
    action_reason, changed_by
  )
  values (
    v_hotel_id, coalesce(NEW.id, OLD.id), coalesce(NEW.staff_id, OLD.staff_id), v_action, v_diff, 
    nullif(current_setting('vaiyu.action_reason', true), ''),
    v_changed_by
  );

  return NEW;
end;
$$;

COMMIT;
