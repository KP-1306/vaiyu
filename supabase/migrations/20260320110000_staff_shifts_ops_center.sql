-- =========================================================
-- 🧠 VAIYU WORKFORCE ENGINE — FINAL PRODUCTION SCHEMA (ABSOLUTE FINAL)
-- =========================================================

BEGIN;

-- =========================================================
-- 0. INDEXES
-- =========================================================
create index if not exists idx_staff_shifts_active_lookup
on public.staff_shifts (staff_id, shift_start, shift_end)
where is_active = true and status = 'scheduled';

create index if not exists idx_staff_shifts_locked
on public.staff_shifts (locked_at)
where locked_at is not null;

-- =========================================================
-- 0b. FIX CORRUPTED DATA + DURATION GUARD
-- =========================================================

-- One-time fix: cap any corrupted shifts to 8 hours
update public.staff_shifts
set shift_end = shift_start + interval '8 hours'
where shift_end - shift_start > interval '24 hours'
  and is_active = true;

-- Hard DB guard: no shift can ever exceed 24 hours
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'max_shift_duration'
  ) then
    alter table public.staff_shifts
    add constraint max_shift_duration
    check (shift_end - shift_start <= interval '24 hours');
  end if;
end $$;

-- =========================================================
-- 1. OVERRIDE REQUESTS
-- =========================================================
create table if not exists public.shift_override_requests (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.staff_shifts(id) on delete cascade,
  requested_by uuid not null references public.hotel_members(id),
  reason text,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.hotel_members(id)
);

create index if not exists idx_override_shift
on public.shift_override_requests (shift_id);

alter table public.shift_override_requests enable row level security;

create policy "allow_authenticated_all"
on public.shift_override_requests
for all
to authenticated
using (true)
with check (true);

-- =========================================================
-- 2. VERSION TRIGGER
-- =========================================================
create or replace function public.sync_staff_shift_version()
returns trigger as $$
begin
  if (
    NEW.shift_start is distinct from OLD.shift_start or
    NEW.shift_end is distinct from OLD.shift_end or
    NEW.shift_type is distinct from OLD.shift_type or
    NEW.zone_id is distinct from OLD.zone_id or
    NEW.status is distinct from OLD.status or
    NEW.staff_id is distinct from OLD.staff_id
  ) then
    NEW.version = OLD.version + 1;
  end if;

  NEW.updated_at = now();
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_staff_shifts_version on public.staff_shifts;

create trigger trg_staff_shifts_version
before update on public.staff_shifts
for each row
execute function public.sync_staff_shift_version();

-- =========================================================
-- 3. ASSIGN SHIFT
-- =========================================================
create or replace function assign_shift(
  p_staff_id uuid,
  p_shift_start timestamptz,
  p_shift_end timestamptz,
  p_shift_type text,
  p_zone_id uuid,
  p_created_by uuid
)
returns uuid
language plpgsql
as $$
declare v_id uuid;
begin
  if p_shift_end <= p_shift_start then
    raise exception 'Invalid shift range';
  end if;

  if p_shift_type not in ('morning','evening','night') then
    raise exception 'Invalid shift type';
  end if;

  if p_shift_end - p_shift_start > interval '24 hours' then
    raise exception 'Shift duration exceeds 24 hours';
  end if;

  insert into public.staff_shifts (
    staff_id, shift_start, shift_end,
    shift_type, zone_id,
    status, is_active, created_by
  )
  values (
    p_staff_id, p_shift_start, p_shift_end,
    p_shift_type::shift_type_enum, p_zone_id,
    'scheduled', true, p_created_by
  )
  returning id into v_id;

  return v_id;

exception when exclusion_violation then
  raise exception 'Shift overlap';
end;
$$;

-- =========================================================
-- 4. UPDATE SHIFT
-- =========================================================
create or replace function update_shift(
  p_shift_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_type text,
  p_zone uuid,
  p_version int,
  p_user uuid
)
returns void
language plpgsql
as $$
declare v record;
begin
  select * into v from public.staff_shifts where id = p_shift_id for update;

  if not found then raise exception 'Shift not found'; end if;
  if v.version != p_version then raise exception 'Version mismatch'; end if;

  if p_type not in ('morning','evening','night') then
    raise exception 'Invalid shift type';
  end if;

  if v.locked_at is not null
     and v.locked_at > now() - interval '5 minutes'
     and v.locked_by is distinct from p_user then
    raise exception 'Locked';
  end if;

  if v.status != 'scheduled' or v.is_active != true then
    raise exception 'Not editable';
  end if;

  if p_end <= p_start then raise exception 'Invalid time'; end if;

  if p_end - p_start > interval '24 hours' then
    raise exception 'Shift duration exceeds 24 hours';
  end if;

  update public.staff_shifts
  set shift_start = p_start,
      shift_end = p_end,
      shift_type = p_type::shift_type_enum,
      zone_id = p_zone
  where id = p_shift_id;

exception when exclusion_violation then
  raise exception 'Overlap';
end;
$$;

-- =========================================================
-- 5. CANCEL SHIFT
-- =========================================================
create or replace function cancel_shift(
  p_shift_id uuid,
  p_version int,
  p_user uuid
)
returns void
language plpgsql
as $$
declare v record;
begin
  select * into v from public.staff_shifts where id = p_shift_id for update;

  if not found then raise exception 'Shift not found'; end if;
  if v.version != p_version then raise exception 'Version mismatch'; end if;

  if v.locked_at is not null
     and v.locked_at > now() - interval '5 minutes'
     and v.locked_by is distinct from p_user then
    raise exception 'Locked';
  end if;

  update public.staff_shifts
  set status = 'cancelled',
      is_active = false,
      cancelled_at = now()
  where id = p_shift_id;
end;
$$;

-- =========================================================
-- 6. LOCK / UNLOCK
-- =========================================================
create or replace function lock_shift(p_id uuid, p_user uuid)
returns void language plpgsql as $$
begin
  update public.staff_shifts
  set locked_at = now(), locked_by = p_user
  where id = p_id
    and (
      locked_at is null
      or locked_at < now() - interval '5 minutes'
      or locked_by = p_user
    );
end;
$$;

create or replace function unlock_shift(p_id uuid, p_user uuid)
returns void language plpgsql as $$
begin
  update public.staff_shifts
  set locked_at = null, locked_by = null
  where id = p_id and locked_by = p_user;
end;
$$;

-- =========================================================
-- 7. MOVE SHIFT
-- =========================================================
create or replace function move_shift(
  p_id uuid, p_start timestamptz, p_end timestamptz,
  p_version int, p_user uuid
)
returns void language plpgsql as $$
declare v record;
begin
  select * into v from public.staff_shifts where id = p_id for update;

  if not found then raise exception 'Shift not found'; end if;
  if v.version != p_version then raise exception 'Version mismatch'; end if;

  if v.locked_at is not null
     and v.locked_at > now() - interval '5 minutes'
     and v.locked_by is distinct from p_user then
    raise exception 'Locked';
  end if;

  if p_end <= p_start then raise exception 'Invalid time'; end if;

  if p_end - p_start > interval '24 hours' then
    raise exception 'Shift duration exceeds 24 hours';
  end if;

  update public.staff_shifts
  set shift_start = p_start,
      shift_end = p_end
  where id = p_id
    and status = 'scheduled'
    and is_active = true;

exception when exclusion_violation then
  raise exception 'Overlap';
end;
$$;

-- =========================================================
-- 8. REASSIGN SHIFT
-- =========================================================
create or replace function reassign_shift(
  p_id uuid, p_staff uuid,
  p_start timestamptz, p_end timestamptz,
  p_zone uuid, p_version int, p_user uuid
)
returns void language plpgsql as $$
declare v record;
begin
  select * into v from public.staff_shifts where id = p_id for update;

  if not found then raise exception 'Shift not found'; end if;
  if v.version != p_version then raise exception 'Version mismatch'; end if;

  if v.locked_at is not null
     and v.locked_at > now() - interval '5 minutes'
     and v.locked_by is distinct from p_user then
    raise exception 'Locked';
  end if;

  if p_end <= p_start then raise exception 'Invalid time'; end if;

  if p_end - p_start > interval '24 hours' then
    raise exception 'Shift duration exceeds 24 hours';
  end if;

  update public.staff_shifts
  set staff_id = p_staff,
      shift_start = p_start,
      shift_end = p_end,
      zone_id = p_zone
  where id = p_id
    and status = 'scheduled'
    and is_active = true;

exception when exclusion_violation then
  raise exception 'Overlap';
end;
$$;

-- =========================================================
-- 9. SPLIT SHIFT
-- =========================================================
create or replace function split_shift(
  p_id uuid, p_split timestamptz,
  p_version int, p_user uuid
)
returns jsonb language plpgsql as $$
declare v record; v_new uuid;
begin
  select * into v from public.staff_shifts where id = p_id for update;

  if not found then raise exception 'Shift not found'; end if;
  if v.version != p_version then raise exception 'Version mismatch'; end if;

  if v.locked_at is not null
     and v.locked_at > now() - interval '5 minutes'
     and v.locked_by is distinct from p_user then
    raise exception 'Locked';
  end if;

  if p_split <= v.shift_start or p_split >= v.shift_end then
    raise exception 'Invalid split';
  end if;

  insert into public.staff_shifts (
    staff_id, shift_start, shift_end,
    shift_type, zone_id, status, is_active, created_by
  )
  values (
    v.staff_id, p_split, v.shift_end,
    v.shift_type, v.zone_id, v.status, true, v.created_by
  )
  returning id into v_new;

  update public.staff_shifts
  set shift_end = p_split
  where id = p_id;

  return jsonb_build_object('original', p_id, 'new', v_new);
end;
$$;

-- =========================================================
-- 10. BULK ASSIGN
-- =========================================================
create or replace function bulk_assign_shifts(
  p_shifts jsonb,
  p_user uuid
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
      if (v_item->>'shift_type') not in ('morning','evening','night') then
        v_result := v_result || jsonb_build_object(
          'staff_id', v_item->>'staff_id',
          'status', 'invalid_shift_type'
        );
        continue;
      end if;

      if (v_item->>'shift_end')::timestamptz <= (v_item->>'shift_start')::timestamptz then
        v_result := v_result || jsonb_build_object(
          'staff_id', v_item->>'staff_id',
          'status', 'invalid_time'
        );
        continue;
      end if;

      insert into public.staff_shifts (
        staff_id,
        shift_start,
        shift_end,
        shift_type,
        zone_id,
        status,
        is_active,
        created_by
      )
      values (
        (v_item->>'staff_id')::uuid,
        (v_item->>'shift_start')::timestamptz,
        (v_item->>'shift_end')::timestamptz,
        (v_item->>'shift_type')::shift_type_enum,
        (v_item->>'zone_id')::uuid,
        'scheduled',
        true,
        p_user
      )
      returning id into v_shift_id;

      v_result := v_result || jsonb_build_object(
        'staff_id', v_item->>'staff_id',
        'status', 'success',
        'shift_id', v_shift_id
      );

    exception
      when exclusion_violation then
        v_result := v_result || jsonb_build_object(
          'staff_id', v_item->>'staff_id',
          'status', 'conflict'
        );
    end;
  end loop;

  return v_result;
end;
$$;

-- =========================================================
-- 11. OVERRIDE FLOW
-- =========================================================
create or replace function request_shift_override(
  p_shift_id uuid,
  p_user uuid,
  p_reason text
)
returns uuid
language plpgsql as $$
declare v uuid;
begin
  if not exists (select 1 from staff_shifts where id = p_shift_id) then
    raise exception 'Shift not found';
  end if;

  insert into shift_override_requests(shift_id, requested_by, reason)
  values (p_shift_id, p_user, p_reason)
  returning id into v;

  return v;
end;
$$;

create or replace function resolve_shift_override(
  p_id uuid,
  p_action text,
  p_user uuid
)
returns void
language plpgsql as $$
declare v_shift uuid;
begin
  if p_action not in ('approved','rejected') then
    raise exception 'Invalid action';
  end if;

  select shift_id into v_shift
  from shift_override_requests
  where id = p_id and status='pending';

  if not found then raise exception 'Invalid request'; end if;

  update shift_override_requests
  set status=p_action, resolved_at=now(), resolved_by=p_user
  where id = p_id;

  if p_action='approved' then
    update staff_shifts set locked_at=null, locked_by=null where id=v_shift;
  end if;
end;
$$;

-- =========================================================
-- 7. SMART SCHEDULER ENGINE
-- =========================================================
create or replace function public.generate_schedule_plan(
  p_hotel_id uuid,
  p_week_start date,
  p_zone_id uuid default null,
  p_demand jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date;
  v_shift record;
  v_staff record;

  v_assignments jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_already_planned jsonb := '[]'::jsonb;

  v_assigned int;
begin

  -- =========================================================
  -- 🛡 0. SAFETY: No staff in hotel
  -- =========================================================
  if not exists (
    select 1 from public.hotel_members
    where hotel_id = p_hotel_id and is_active = true
  ) then
    return jsonb_build_object(
      'assignments', '[]'::jsonb,
      'conflicts', jsonb_build_array(
        jsonb_build_object('reason','no_staff_in_hotel')
      )
    );
  end if;

  -- =========================================================
  -- 🛡 1. DEFAULT DEMAND
  -- =========================================================
  if p_demand is null then
    p_demand := jsonb_build_array(
      jsonb_build_object('shift_type','morning','required',1),
      jsonb_build_object('shift_type','evening','required',1),
      jsonb_build_object('shift_type','night','required',1)
    );
  end if;

  -- =========================================================
  -- 🔁 2. LOOP 7 DAYS
  -- =========================================================
  for i in 0..6 loop
    v_day := p_week_start + i;

    -- =========================================================
    -- 🔁 3. LOOP SHIFT TYPES
    -- =========================================================
    for v_shift in
      select * from jsonb_to_recordset(p_demand)
      as x(shift_type text, required int)
    loop

      -- 🛡 VALIDATE SHIFT TYPE
      if v_shift.shift_type not in ('morning','evening','night') then
        v_conflicts := v_conflicts || jsonb_build_object(
          'date', v_day,
          'shift_type', v_shift.shift_type,
          'reason', 'invalid_shift_type'
        );
        continue;
      end if;

      v_assigned := 0;

      -- =========================================================
      -- 🔁 4. FILL REQUIRED SLOTS
      -- =========================================================
      while v_assigned < v_shift.required loop

        -- 🎯 FIND BEST STAFF
        select hm.id as staff_id
        into v_staff
        from public.hotel_members hm
        where hm.hotel_id = p_hotel_id
          and hm.is_active = true

          -- zone filter
          and (
            p_zone_id is null
            or exists (
              select 1 from public.staff_zone_assignments sza
              where sza.staff_id = hm.id
                and sza.zone_id = p_zone_id
            )
          )

          -- ❌ already assigned in DB that day
          and not exists (
            select 1 from public.staff_shifts ss
            where ss.staff_id = hm.id
              and ss.shift_start::date = v_day
              and ss.is_active = true
              and ss.status = 'scheduled'
          )

          -- ❌ already assigned in this plan
          and not exists (
            select 1 from jsonb_array_elements(v_already_planned) as p
            where (p->>'staff_id')::uuid = hm.id
              and (p->>'day')::date = v_day
          )

        order by
          -- 🧠 fairness (DB + planned)
          (
            (select count(*) from public.staff_shifts s2
             where s2.staff_id = hm.id
               and s2.shift_start >= p_week_start
               and s2.shift_start < p_week_start + interval '7 days'
               and s2.is_active = true
               and s2.status = 'scheduled')
            +
            (select count(*) from jsonb_array_elements(v_already_planned) as p2
             where (p2->>'staff_id')::uuid = hm.id)
          ) asc,
          hm.id -- deterministic (no randomness)
        limit 1;

        -- ❌ NO STAFF FOUND → CONFLICT
        if v_staff.staff_id is null then
          v_conflicts := v_conflicts || jsonb_build_object(
            'date', v_day,
            'shift_type', v_shift.shift_type,
            'reason', 'no_available_staff'
          );
          exit;
        end if;

        -- =========================================================
        -- ⏱ 5. BUILD SHIFT TIMES (IST SAFE)
        -- =========================================================
        v_assignments := v_assignments || jsonb_build_object(
          'staff_id', v_staff.staff_id,

          'shift_start',
            case v_shift.shift_type
              when 'morning' then (v_day + time '09:00') at time zone 'Asia/Kolkata'
              when 'evening' then (v_day + time '14:00') at time zone 'Asia/Kolkata'
              when 'night'   then (v_day + time '22:00') at time zone 'Asia/Kolkata'
            end,

          'shift_end',
            case v_shift.shift_type
              when 'morning' then (v_day + time '17:00') at time zone 'Asia/Kolkata'
              when 'evening' then (v_day + time '22:00') at time zone 'Asia/Kolkata'
              when 'night'   then ((v_day + interval '1 day') + time '06:00') at time zone 'Asia/Kolkata'
            end,

          'shift_type', v_shift.shift_type,
          'zone_id', p_zone_id
        );

        -- 🧠 TRACK IN-PLAN ASSIGNMENT
        v_already_planned := v_already_planned || jsonb_build_object(
          'staff_id', v_staff.staff_id,
          'day', v_day
        );

        v_assigned := v_assigned + 1;

      end loop;

    end loop;
  end loop;

  -- =========================================================
  -- ✅ FINAL RESPONSE
  -- =========================================================
  return jsonb_build_object(
    'assignments', v_assignments,
    'conflicts', v_conflicts
  );

end;
$$;


-- =========================================================
-- STEP 8: Shift Audit Log (REFINED PRODUCTION DESIGN)
-- =========================================================

-- =========================================================
-- STEP 8: Shift Audit Log (PRODUCTION HARDENED)
-- =========================================================

create table if not exists public.shift_audit_log (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null,
  shift_id uuid not null,
  staff_id uuid not null,
  action text not null check (action in ('created','updated','cancelled','deleted')),
  diff jsonb not null, -- Stores: { "field": { "old": "...", "new": "..." } }
  action_reason text,  -- Optional: why this happened (AI/Manual/System)
  changed_by uuid,
  changed_at timestamptz not null default now()
);

-- Indexes for production performance
create index if not exists idx_audit_hotel_time on public.shift_audit_log (hotel_id, changed_at desc);
create index if not exists idx_audit_staff_time on public.shift_audit_log (staff_id, changed_at desc);
create index if not exists idx_audit_hotel_staff_time on public.shift_audit_log (hotel_id, staff_id, changed_at desc);

-- RLS (Security First)
alter table public.shift_audit_log enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'hotel scoped read' and tablename = 'shift_audit_log') then
    create policy "hotel scoped read"
    on public.shift_audit_log
    for select
    to authenticated
    using (
      hotel_id in (
        select hotel_id from public.hotel_members
        where user_id = auth.uid()
      )
    );
  end if;
end $$;

-- =========================================================
-- STEP 9: Smart Audit Trigger (Hardened)
-- =========================================================

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
  -- 👤 Identify Actor (Supabase production pattern)
  v_changed_by := coalesce(
    current_setting('request.jwt.claim.sub', true)::uuid,
    auth.uid(),
    NEW.created_by,
    OLD.created_by
  );

  -- 🏢 Lookup hotel_id correctly (staff_id = profiles.id)
  select hm.hotel_id into v_hotel_id
  from public.hotel_members hm
  where hm.id = coalesce(NEW.staff_id, OLD.staff_id)
  limit 1;

  -- 🛡 MANDATORY: Prevent orphan audit logs
  if v_hotel_id is null then
    raise exception 'Audit failed: hotel_id not found for staff_id %', coalesce(NEW.staff_id, OLD.staff_id);
  end if;

  -- 🎯 Detect action & compute diff
  if tg_op = 'INSERT' then
    v_action := 'created';
    v_diff := jsonb_build_object(
      'staff_id',    jsonb_build_object('new', NEW.staff_id),
      'status',       jsonb_build_object('new', NEW.status),
      'shift_start', jsonb_build_object('new', NEW.shift_start),
      'shift_end',   jsonb_build_object('new', NEW.shift_end),
      'shift_type',  jsonb_build_object('new', NEW.shift_type),
      'zone_id',     jsonb_build_object('new', NEW.zone_id)
    );

  elsif tg_op = 'UPDATE' then
    -- Skip noise (locks, version bumps)
    if (
      NEW.shift_start is not distinct from OLD.shift_start and
      NEW.shift_end is not distinct from OLD.shift_end and
      NEW.shift_type is not distinct from OLD.shift_type and
      NEW.zone_id is not distinct from OLD.zone_id and
      NEW.status is not distinct from OLD.status and
      NEW.staff_id is not distinct from OLD.staff_id
    ) then
      return NEW;
    end if;

    if NEW.status = 'cancelled' and (OLD.status is null or OLD.status != 'cancelled') then
      v_action := 'cancelled';
    else
      v_action := 'updated';
    end if;

    -- Compute clean field-level diff
    v_diff := jsonb_strip_nulls(jsonb_build_object(
      'shift_start', case when NEW.shift_start is distinct from OLD.shift_start then jsonb_build_object('old', OLD.shift_start, 'new', NEW.shift_start) end,
      'shift_end',   case when NEW.shift_end   is distinct from OLD.shift_end   then jsonb_build_object('old', OLD.shift_end,   'new', NEW.shift_end) end,
      'shift_type',  case when NEW.shift_type  is distinct from OLD.shift_type  then jsonb_build_object('old', OLD.shift_type,  'new', NEW.shift_type) end,
      'staff_id',    case when NEW.staff_id    is distinct from OLD.staff_id    then jsonb_build_object('old', OLD.staff_id,    'new', NEW.staff_id) end,
      'zone_id',     case when NEW.zone_id     is distinct from OLD.zone_id     then jsonb_build_object('old', OLD.zone_id,     'new', NEW.zone_id) end,
      'status',      case when NEW.status      is distinct from OLD.status      then jsonb_build_object('old', OLD.status,      'new', NEW.status) end
    ));

  elsif tg_op = 'DELETE' then
    v_action := 'deleted';
    v_diff := jsonb_build_object(
      'deleted', true,
      'shift_start', OLD.shift_start,
      'shift_end',   OLD.shift_end,
      'staff_id',    OLD.staff_id,
      'status',      OLD.status
    );
  end if;

  -- 📝 Record the audit
  insert into public.shift_audit_log (
    hotel_id, shift_id, staff_id, action, diff, changed_by
  ) values (
    v_hotel_id,
    coalesce(NEW.id, OLD.id),
    coalesce(NEW.staff_id, OLD.staff_id),
    v_action,
    v_diff,
    v_changed_by
  );

  if tg_op = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

-- 🔗 Re-attach Trigger
drop trigger if exists trg_shift_audit on public.staff_shifts;
create trigger trg_shift_audit
after insert or update or delete on public.staff_shifts
for each row execute function public.trg_shift_audit();

-- =========================================================
-- STEP 10: Robust History RPC with Metadata
-- =========================================================

create or replace function public.get_shift_history(
  p_hotel_id uuid,
  p_staff_id uuid default null,
  p_limit int default 20,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data jsonb;
  v_has_more boolean;
begin
  -- 🛡 Security: Verify caller's membership
  if not exists (
    select 1 from public.hotel_members
    where user_id = auth.uid() and hotel_id = p_hotel_id
  ) then
    raise exception 'Unauthorized';
  end if;

  -- Fetch data (one extra to check has_more)
  select jsonb_agg(row_to_json(t))
  into v_data
  from (
    select
      sal.id,
      sal.shift_id,
      sal.staff_id,
      p.full_name as staff_name,
      sal.action,
      sal.diff,
      sal.action_reason,
      sal.changed_by,
      cp.full_name as changed_by_name,
      sal.changed_at
    from public.shift_audit_log sal
    left join public.profiles p on p.id = sal.staff_id
    left join public.profiles cp on cp.id = sal.changed_by
    where sal.hotel_id = p_hotel_id
      and (p_staff_id is null or sal.staff_id = p_staff_id)
    order by sal.changed_at desc
    limit p_limit + 1 offset p_offset
  ) t;

  v_has_more := coalesce(jsonb_array_length(v_data), 0) > p_limit;
  
  -- Trim if we have more (using cleaner subquery approach)
  if v_has_more then
    v_data := (
      select jsonb_agg(elem)
      from (
        select elem
        from jsonb_array_elements(v_data) with ordinality as arr(elem, idx)
        where idx <= p_limit
      ) s
    );
  end if;

  return jsonb_build_object(
    'data', coalesce(v_data, '[]'::jsonb),
    'limit', p_limit,
    'offset', p_offset,
    'has_more', v_has_more
  );
end;
$$;

COMMIT;