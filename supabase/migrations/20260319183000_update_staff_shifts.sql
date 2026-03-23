-- =========================================================
-- staff_shifts Schema Update (FINAL PRODUCTION VERSION)
-- =========================================================

-- =========================================================
-- STEP 1: Add new columns
-- =========================================================

alter table public.staff_shifts
add column if not exists zone_id uuid null,
add column if not exists shift_type text null,
add column if not exists status text not null default 'scheduled',
add column if not exists created_by uuid null references public.hotel_members(id),
add column if not exists cancelled_at timestamptz null,
add column if not exists version integer not null default 1,
add column if not exists locked_at timestamptz null,
add column if not exists locked_by uuid null references public.hotel_members(id);

-- =========================================================
-- STEP 2: FK constraint
-- =========================================================

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'staff_shifts_zone_id_fkey'
  ) then
    alter table public.staff_shifts
    add constraint staff_shifts_zone_id_fkey
    foreign key (zone_id)
    references public.hotel_zones(id)
    on delete set null;
  end if;
end $$;

-- =========================================================
-- STEP 3: Check constraints
-- =========================================================

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'staff_shifts_shift_type_check'
  ) then
    alter table public.staff_shifts
    add constraint staff_shifts_shift_type_check
    check (shift_type in ('morning','evening','night'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'staff_shifts_status_check'
  ) then
    alter table public.staff_shifts
    add constraint staff_shifts_status_check
    check (status in ('scheduled','completed','cancelled'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'staff_shifts_cancelled_consistency_check'
  ) then
    alter table public.staff_shifts
    add constraint staff_shifts_cancelled_consistency_check
    check (
      (status = 'cancelled' and cancelled_at is not null)
      or
      (status != 'cancelled' and cancelled_at is null)
    );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'staff_shifts_lock_consistency_check'
  ) then
    alter table public.staff_shifts
    add constraint staff_shifts_lock_consistency_check
    check (
      (locked_at is null and locked_by is null)
      or
      (locked_at is not null and locked_by is not null)
    );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'staff_shifts_valid_time_range'
  ) then
    alter table public.staff_shifts
    add constraint staff_shifts_valid_time_range
    check (shift_end > shift_start);
  end if;

end $$;

-- =========================================================
-- STEP 4: Backfills
-- =========================================================

update public.staff_shifts
set shift_type = case
  when extract(hour from shift_start) >= 6 and extract(hour from shift_start) < 14 then 'morning'
  when extract(hour from shift_start) >= 14 and extract(hour from shift_start) < 22 then 'evening'
  else 'night'
end
where shift_type is null;

update public.staff_shifts ss
set zone_id = z.zone_id
from (
  select ss_inner.id as shift_id, z1.zone_id
  from public.staff_shifts ss_inner
  join lateral (
    select zone_id
    from public.staff_zone_assignments sza
    where sza.staff_id = ss_inner.staff_id
      and sza.effective_from <= ss_inner.shift_start
      and (sza.effective_to is null or sza.effective_to >= ss_inner.shift_start)
    order by sza.effective_from desc
    limit 1
  ) z1 on true
) z
where ss.id = z.shift_id
  and ss.zone_id is null;

-- =========================================================
-- STEP 5: Enforce NOT NULL
-- =========================================================

alter table public.staff_shifts
alter column shift_type set not null;

-- =========================================================
-- STEP 6: Indexes (IMMUTABLE SAFE)
-- =========================================================

create index if not exists idx_staff_shifts_active_time
on public.staff_shifts (staff_id, shift_start, shift_end);

create index if not exists idx_staff_shifts_zone
on public.staff_shifts (zone_id);

create index if not exists idx_staff_shifts_shift_type
on public.staff_shifts (shift_type);

create index if not exists idx_staff_shifts_created_by
on public.staff_shifts (created_by);

drop index if exists idx_staff_shifts_status;
create index if not exists idx_staff_shifts_status_active
on public.staff_shifts (status)
where is_active = true;

-- ✅ FIXED (IMMUTABLE via IST timezone)
create index if not exists idx_staff_shifts_day
on public.staff_shifts (((shift_start AT TIME ZONE 'Asia/Kolkata')::date));

create index if not exists idx_staff_shifts_day_ordered
on public.staff_shifts (((shift_start AT TIME ZONE 'Asia/Kolkata')::date), shift_start);

create index if not exists idx_staff_shifts_staff_day
on public.staff_shifts (staff_id, ((shift_start AT TIME ZONE 'Asia/Kolkata')::date), shift_start);

create index if not exists idx_staff_shifts_range
on public.staff_shifts (staff_id, shift_start, shift_end);

create index if not exists idx_staff_shifts_current
on public.staff_shifts (shift_start, shift_end)
where is_active = true and status = 'scheduled';

create index if not exists idx_staff_shifts_locked
on public.staff_shifts (locked_at)
where locked_at is not null;

-- 🛡 CRITICAL: Bulletproof active window index (accelerates NOT EXISTS & LATERAL)
create index if not exists idx_staff_shifts_active_window
on public.staff_shifts (staff_id, shift_start, shift_end)
where is_active = true and status = 'scheduled';

-- =========================================================
-- STEP 7: Overlap constraint
-- =========================================================

create extension if not exists btree_gist;

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'no_overlapping_shifts'
  ) then
    alter table public.staff_shifts
    drop constraint no_overlapping_shifts;
  end if;

  alter table public.staff_shifts
  add constraint no_overlapping_shifts
  exclude using gist (
    staff_id with =,
    tstzrange(shift_start, shift_end, '[)') with &&
  )
  where (status = 'scheduled' and is_active = true)
  deferrable initially immediate;
end $$;

-- =========================================================
-- STEP 8: Trigger
-- =========================================================

create or replace function staff_shifts_before_write()
returns trigger as $$
declare
  is_business_data_changed boolean;
  is_lock_changing boolean;
begin
  if TG_OP = 'INSERT' then
    new.version = coalesce(new.version, 1);
  end if;

  if TG_OP = 'UPDATE' then
    is_business_data_changed := (
      new.shift_start is distinct from old.shift_start or
      new.shift_end   is distinct from old.shift_end   or
      new.zone_id     is distinct from old.zone_id     or
      new.shift_type  is distinct from old.shift_type  or
      new.status      is distinct from old.status      or
      new.is_active   is distinct from old.is_active
    );

    is_lock_changing := (
      new.locked_at is distinct from old.locked_at or
      new.locked_by is distinct from old.locked_by
    );
  end if;

  if TG_OP = 'UPDATE' and is_lock_changing then
    if old.locked_at is not null
       and old.locked_at > now() - interval '5 minutes'
       and old.locked_by is not null
       and (
         new.locked_by is null 
         or new.locked_by is distinct from old.locked_by
       ) then
      raise exception 'Shift is currently locked by another user';
    end if;
  end if;

  if TG_OP = 'UPDATE' and is_business_data_changed then
    new.version = old.version + 1;
  end if;

  if TG_OP = 'UPDATE' then
    if old.status = 'cancelled' and new.status != 'cancelled' then
      raise exception 'Cannot reactivate a cancelled shift';
    end if;

    if old.status = 'completed' and is_business_data_changed then
      raise exception 'Cannot modify a completed shift';
    end if;
  end if;

  if new.status = 'cancelled' then
    if new.cancelled_at is null then
      new.cancelled_at = now();
    end if;
  else
    new.cancelled_at = null;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_staff_shifts_before_write on public.staff_shifts;

create trigger trg_staff_shifts_before_write
before insert or update on public.staff_shifts
for each row
execute function staff_shifts_before_write();

-- =========================================================
-- STEP 9: Views (DYNAMIC UI ENGINE)
-- =========================================================

-- 1️⃣ v_staff_shift_board: Primary UI data source
create or replace view v_staff_shift_board as
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

  d.id as department_id,
  d.name as department_name,

  -- 🟢 LIVE STATE
  (now() between ss.shift_start and ss.shift_end) 
    and ss.status = 'scheduled'
    and ss.is_active = true as is_on_shift,

  -- ⏱ duration
  extract(epoch from (ss.shift_end - ss.shift_start))/3600 as hours,

  -- 🔒 locking
  case 
    when ss.locked_at is not null 
     and ss.locked_at > now() - interval '5 minutes'
    then true
    else false
  end as is_locked,

  ss.locked_by

from public.staff_shifts ss
join public.hotel_members hm on hm.id = ss.staff_id
left join public.profiles p on p.id = hm.user_id
left join public.hotel_zones z on z.id = ss.zone_id
left join public.staff_departments sd on sd.staff_id = ss.staff_id
left join public.departments d on d.id = sd.department_id
where ss.is_active = true;

-- 2️⃣ v_available_staff: Identifies staff who are NOT currently on a shift
create or replace view v_available_staff as
select
  hm.id as staff_id,
  p.full_name,

  d.id as department_id,
  d.name as department_name,

  z.id as zone_id,
  z.name as zone_name

from public.hotel_members hm
left join public.profiles p on p.id = hm.user_id
left join public.staff_departments sd on sd.staff_id = hm.id
left join public.departments d on d.id = sd.department_id
left join public.staff_zone_assignments sza 
  on sza.staff_id = hm.id
  and sza.effective_to is null
left join public.hotel_zones z on z.id = sza.zone_id
where not exists (
  select 1 
  from public.staff_shifts ss
  where ss.staff_id = hm.id
    and ss.status = 'scheduled'
    and ss.is_active = true
    and now() between ss.shift_start and ss.shift_end
);

-- 3️⃣ v_staff_shift_summary: Aggregated dashboard statistics
create or replace view v_staff_shift_summary as
select
  count(*) filter (where is_on_shift) as on_shift,
  count(*) filter (where not is_on_shift) as off_shift,

  count(*) filter (where shift_type::text = 'morning') as morning,
  count(*) filter (where shift_type::text = 'evening') as evening,
  count(*) filter (where shift_type::text = 'night') as night
from v_staff_shift_board;

-- 4️⃣ get_staff_shifts_dashboard: Deterministic Operational Board Eng-- 🏗️ Performance Index for Dashboard Lookups
create index if not exists idx_staff_shifts_active_lookup
on public.staff_shifts (staff_id, shift_start, shift_end)
where is_active = true and status = 'scheduled';

create or replace function get_staff_shifts_dashboard(
  p_hotel_id uuid,
  p_selected_day timestamptz,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_next_day timestamptz;
  v_result jsonb;
begin
  -- 🛡️ 1. Normalize to IST day start
  p_selected_day := date_trunc('day', p_selected_day AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';
  v_next_day := p_selected_day + interval '1 day';

  with staff_zones as (
    select distinct on (sza.staff_id)
      sza.staff_id,
      z1.name as zone_name,
      z1.id as zone_id
    from public.staff_zone_assignments sza
    join public.hotel_zones z1 on z1.id = sza.zone_id
    where sza.effective_from <= p_selected_day
      and (sza.effective_to is null or sza.effective_to >= p_selected_day)
    order by sza.staff_id, sza.effective_from desc
  ),

  staff_departments_dedup as (
    select distinct on (sd.staff_id)
      sd.staff_id,
      d.name as department_name
    from public.staff_departments sd
    join public.departments d on d.id = sd.department_id
    order by sd.staff_id
  ),

  timeline_data as (
    select jsonb_agg(sub order by sub.full_name) as timeline
    from (
      select 
        hm.id as staff_id,
        coalesce(p.full_name, p.email, 'User ' || left(hm.id::text, 4)) as full_name,
        p.profile_photo_url as avatar_url,
        sdd.department_name,
        sz.zone_name as assigned_zone_name,

        -- shift existence
        coalesce(bool_or(ss.shift_id is not null), false) as has_shift,

        -- current shift (Robust alternative to max(uuid))
        (array_agg(ss.shift_id) filter (where ss.is_current))[1] as current_shift_id,

        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'shift_id', ss.shift_id,
              'staff_id', hm.id,
              'shift_start', ss.shift_start,
              'shift_end', ss.shift_end,
              'shift_type', ss.shift_type,
              'status', ss.status,
              'zone_id', ss.zone_id,
              'zone_name', ss.zone_name,
              'is_on_shift', ss.is_in_day,
              'is_locked', ss.is_locked,
              'locked_by', ss.locked_by,
              'locked_by_name', lp.full_name,
              'version', ss.version
            )
            order by ss.shift_start
          ) filter (where ss.shift_id is not null),
          '[]'::jsonb
        ) as shifts

      from public.hotel_members hm
      left join public.profiles p on p.id = hm.user_id
      left join staff_departments_dedup sdd on sdd.staff_id = hm.id
      left join staff_zones sz on sz.staff_id = hm.id

      -- 🔥 Single optimized shift scan
      left join lateral (
        select 
          vss.id as shift_id,
          vss.shift_start,
          vss.shift_end,
          vss.shift_type,
          vss.status,
          vss.version,
          vss.zone_id,
          vss.locked_at,
          vss.locked_by,
          hz.name as zone_name,

          -- derived flags
          (vss.shift_start < v_next_day and vss.shift_end >= p_selected_day) as is_in_day,
          (vss.shift_start <= p_now and vss.shift_end > p_now) as is_current,
          (vss.locked_at is not null and vss.locked_at > (p_now - interval '5 minutes')) as is_locked

        from public.staff_shifts vss
        left join public.hotel_zones hz on hz.id = vss.zone_id
        where vss.staff_id = hm.id
          and vss.shift_start < v_next_day
          and vss.shift_end >= p_selected_day
          and vss.is_active = true
          and vss.status = 'scheduled'
      ) ss on true

      left join public.profiles lp on lp.id = ss.locked_by

      where hm.hotel_id = p_hotel_id
        and hm.is_active = true

      group by hm.id, p.full_name, p.email, p.profile_photo_url, sdd.department_name, sz.zone_name
      order by full_name
    ) sub
  ),

  available_data as (
    select jsonb_agg(sub order by sub.full_name) as available
    from (
      select 
        hm.id as staff_id,
        coalesce(p.full_name, p.email, 'User ' || left(hm.id::text, 4)) as full_name,
        p.profile_photo_url as avatar_url,
        sdd.department_name,
        sz.zone_id,
        sz.zone_name

      from public.hotel_members hm
      left join public.profiles p on p.id = hm.user_id
      left join staff_departments_dedup sdd on sdd.staff_id = hm.id
      left join staff_zones sz on sz.staff_id = hm.id

      where hm.hotel_id = p_hotel_id
        and hm.is_active = true
        and not exists (
        select 1 from public.staff_shifts ss
        where ss.staff_id = hm.id
          and ss.shift_start < v_next_day
          and ss.shift_end >= p_selected_day
          and ss.is_active = true
          and ss.status = 'scheduled'
      )

      order by full_name
    ) sub
  ),

  summary_data as (
    select jsonb_build_object(
      'total_staff', count(distinct hm.id),

      'on_shift', count(distinct ss.staff_id) filter (
        where ss.shift_start < v_next_day
          and ss.shift_end >= p_selected_day
          and ss.status = 'scheduled'
      ),

      'off_shift',
        count(distinct hm.id)
        - count(distinct ss.staff_id) filter (
            where ss.shift_start < v_next_day
              and ss.shift_end >= p_selected_day
              and ss.status = 'scheduled'
          ),

      'morning', count(distinct ss.staff_id) filter (where ss.shift_type::text = 'morning' and ss.status = 'scheduled'),
      'evening', count(distinct ss.staff_id) filter (where ss.shift_type::text = 'evening' and ss.status = 'scheduled'),
      'night', count(distinct ss.staff_id) filter (where ss.shift_type::text = 'night' and ss.status = 'scheduled')

    ) as summary
    from public.hotel_members hm
    left join public.staff_shifts ss 
      on ss.staff_id = hm.id
      and ss.shift_start < v_next_day
      and ss.shift_end >= p_selected_day
      and ss.is_active = true
      and ss.status = 'scheduled'

    where hm.hotel_id = p_hotel_id
      and hm.is_active = true
  )

  select jsonb_build_object(
    'timeline', coalesce(t.timeline, '[]'::jsonb),
    'available', coalesce(a.available, '[]'::jsonb),
    'summary', coalesce(
      s.summary,
      jsonb_build_object(
        'total_staff',0,'on_shift',0,'off_shift',0,
        'morning',0,'evening',0,'night',0
      )
    )
  )
  into v_result
  from timeline_data t, available_data a, summary_data s;

  return v_result;
end;
$$;