-- 20260702000003_reserved_slug_guard.sql
--
-- Guard against a hotel slug that would SHADOW an application route once we start
-- serving the public site at the bare path vaiyu.co.in/{slug}. A colliding slug
-- (e.g. "owner", "about") would otherwise place a static /{slug}/index.html in
-- front of a real app route.
--
-- NO existing-row impact:
--  * enforced by a TRIGGER on BEFORE INSERT OR UPDATE OF slug — it fires only on
--    new rows or when the slug column is actually changed, so existing rows are
--    never re-validated (unlike a CHECK constraint, which would reject the whole
--    table on apply if any current slug collided).
--  * the audit block below only RAISES A NOTICE for any pre-existing collision;
--    it never renames or fails. (Local: zero collisions.)
--
-- Maintenance: when a new TOP-LEVEL app route segment is added, add it here.

create or replace function public.is_reserved_hotel_slug(p_slug text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p_slug, '')) = any (array[
    -- app route segments (first path segment of every top-level route)
    'about','about-ai','admin','app','auth','availability','bill','bills','booking',
    'bookings','careers','checkin','checkout','contact','desk','details','feedback',
    'grid','guest','guestold','guestnew','hk','hotel','invite','kitchen','kyc','logout',
    'maint','menu','ok','onboard','ops','owner','p','payment','precheckin','press',
    'privacy','profile','regcard','request-service','requesttracker','review','rewards',
    'room-assignment','scan','signin','staff','status','stay','stays','success','support',
    'terms','thanks','track','track-order','trips','walk-in','walkin','walkin-payment',
    'welcome',
    -- static asset dirs / files + reverse-proxy prefixes (netlify.toml)
    'api','assets','brand','hero','icons','illustrations','functions',
    'favicon.ico','index.html','manifest.json','robots.txt','sitemap.xml','sw.js',
    '.well-known','_next',
    -- reserved for future namespacing + common system paths
    'h','www','static','public','site','sites','health','healthz'
  ]);
$$;

comment on function public.is_reserved_hotel_slug(text) is
  'True if a slug collides with an application route / static path and must not be used as a public hotel slug (bare vaiyu.co.in/{slug} serving). Keep in sync with top-level routes.';

create or replace function public._hotel_slug_reserved_guard()
returns trigger
language plpgsql
as $$
begin
  if new.slug is not null and public.is_reserved_hotel_slug(new.slug) then
    raise exception 'RESERVED_SLUG: "%" collides with an application route and cannot be used as a hotel slug', new.slug
      using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_hotel_slug_reserved_guard on public.hotels;
create trigger trg_hotel_slug_reserved_guard
  before insert or update of slug on public.hotels
  for each row execute function public._hotel_slug_reserved_guard();

-- Read-only audit: warn (do NOT fail) if any EXISTING hotel already collides, so a
-- human can rename it (with a redirect) before enabling bare-slug serving.
do $$
declare
  v_bad text;
begin
  select string_agg(slug, ', ') into v_bad
    from public.hotels
   where public.is_reserved_hotel_slug(slug);
  if v_bad is not null then
    raise warning 'RESERVED_SLUG audit: existing hotels collide with app routes and need renaming before bare-slug serving: %', v_bad;
  else
    raise notice 'RESERVED_SLUG audit: no existing hotel slugs collide with app routes.';
  end if;
end $$;
