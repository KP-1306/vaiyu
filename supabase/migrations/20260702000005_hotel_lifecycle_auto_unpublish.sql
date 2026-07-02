-- 20260702000005_hotel_lifecycle_auto_unpublish.sql
--
-- Operator-reality guard: when a hotel leaves ACTIVE (SUSPENDED / TRIAL_EXPIRED),
-- take its public website DOWN automatically — flip PUBLISHED -> SUSPENDED so the
-- next generator build drops it. Otherwise a non-paying / suspended hotel would
-- keep a live marketing page.
--
-- SECURITY DEFINER so the takedown always succeeds regardless of who changes the
-- lifecycle (owner/manager/admin/cron) — it must never block a lifecycle update.

create or replace function public._hotel_sites_lifecycle_takedown()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if new.lifecycle_status is distinct from old.lifecycle_status
     and new.lifecycle_status in ('SUSPENDED', 'TRIAL_EXPIRED') then
    update public.hotel_sites
       set status = 'SUSPENDED'
     where hotel_id = new.id
       and status = 'PUBLISHED';
  end if;
  return new;
end $$;

drop trigger if exists trg_hotel_sites_lifecycle_takedown on public.hotels;
create trigger trg_hotel_sites_lifecycle_takedown
  after update of lifecycle_status on public.hotels
  for each row execute function public._hotel_sites_lifecycle_takedown();
