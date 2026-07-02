-- 20260702000001_hotel_sites.sql
--
-- Per-hotel PUBLIC marketing website content layer.
-- PURELY ADDITIVE: a new table + view; nothing existing reads or writes these.
--
-- Design notes:
--  * Fixed schema (no custom fields / no page-builder) — per CLAUDE.md anti-features.
--  * Photos are NOT stored here. They live in the DAM (hotel_asset_files, public
--    hotel-assets bucket). hotel_sites holds curated COPY + which DAM file is the
--    hero / OG image + publish state.
--  * "Publish" writes a SNAPSHOT into published_payload; the static site generator
--    renders from that snapshot, so ongoing draft edits never leak onto the live
--    site until the next gated publish re-snapshots.

create table if not exists public.hotel_sites (
  hotel_id            uuid primary key references public.hotels(id) on delete cascade,
  status              text not null default 'DRAFT'
                        check (status in ('DRAFT','PUBLISHED','SUSPENDED')),

  -- Editable draft copy (fixed set of sections; same shape for every hotel)
  tagline             text check (tagline is null or char_length(tagline) <= 200),
  about_md            text check (about_md is null or char_length(about_md) <= 8000),
  dining_intro        text check (dining_intro is null or char_length(dining_intro) <= 2000),
  experiences_intro   text check (experiences_intro is null or char_length(experiences_intro) <= 2000),
  location_intro      text check (location_intro is null or char_length(location_intro) <= 2000),

  -- Curated media picks (which DAM file is the hero / OG card)
  hero_asset_file_id  uuid references public.hotel_asset_files(id) on delete set null,
  og_asset_file_id    uuid references public.hotel_asset_files(id) on delete set null,

  -- SEO overrides (fall back to hotel name/description at render time when null)
  seo_title           text check (seo_title is null or char_length(seo_title) <= 70),
  seo_description     text check (seo_description is null or char_length(seo_description) <= 200),

  -- Conversion CTA
  cta_mode            text not null default 'enquire'
                        check (cta_mode in ('enquire','booking_url')),

  theme_overrides     jsonb not null default '{}'::jsonb,

  -- Publish SNAPSHOT: what the static generator renders.
  published_payload   jsonb,
  published_at        timestamptz,
  published_by        uuid references auth.users(id),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Cannot be PUBLISHED without a snapshot to serve (operator reality: no empty sites).
  constraint hotel_sites_published_has_payload
    check (status <> 'PUBLISHED' or published_payload is not null)
);

comment on table public.hotel_sites is
  'Per-hotel public marketing website content (copy + DAM media picks + publish snapshot). Fixed schema — no custom fields. Photos live in hotel_asset_files.';

-- updated_at touch
create or replace function public._hotel_sites_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_hotel_sites_touch_updated_at on public.hotel_sites;
create trigger trg_hotel_sites_touch_updated_at
  before update on public.hotel_sites
  for each row execute function public._hotel_sites_touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.hotel_sites enable row level security;

-- Read (draft + published): any hotel member may view their hotel's site content;
-- platform admins may view any (seed/review). Anon gets NOTHING here — the public
-- read path is the v_public_hotel_sites view (published snapshot only).
drop policy if exists hotel_sites_select_for_members on public.hotel_sites;
create policy hotel_sites_select_for_members on public.hotel_sites
  for select
  using (public.is_platform_admin() or public.vaiyu_is_hotel_member(hotel_id));

-- Write: owner/manager tier (canonical mapper) + platform admin (VAiyu seed).
-- Mirrors the hotels write gate; staff cannot edit marketing copy.
drop policy if exists hotel_sites_insert_for_managers on public.hotel_sites;
create policy hotel_sites_insert_for_managers on public.hotel_sites
  for insert
  with check (public.is_platform_admin() or public.vaiyu_is_hotel_manager(hotel_id));

drop policy if exists hotel_sites_update_for_managers on public.hotel_sites;
create policy hotel_sites_update_for_managers on public.hotel_sites
  for update
  using (public.is_platform_admin() or public.vaiyu_is_hotel_manager(hotel_id))
  with check (public.is_platform_admin() or public.vaiyu_is_hotel_manager(hotel_id));

-- (No DELETE policy: sites are unpublished, not deleted; hotel delete cascades.)

-- ── Public view (anon-safe): PUBLISHED snapshot only ─────────────────────────
-- DEFINER view (mirrors v_public_hotels): exposes ONLY the published snapshot +
-- public hotel identity, and ONLY for PUBLISHED rows. Draft columns and
-- draft/suspended rows are never exposed. All published sites are public by
-- design, so there is no cross-tenant concern — same rationale as v_public_hotels.
-- MUST stay definer: a future "flip views to security_invoker" sweep would break
-- anon reads here (there is deliberately no anon RLS policy on hotel_sites).
create or replace view public.v_public_hotel_sites as
select
  hs.hotel_id,
  h.slug,
  h.name,
  hs.published_payload,
  hs.published_at
from public.hotel_sites hs
join public.hotels h on h.id = hs.hotel_id
where hs.status = 'PUBLISHED';

comment on view public.v_public_hotel_sites is
  'Public (anon) read path for published hotel sites. Definer-by-design (like v_public_hotels): exposes only published_payload for PUBLISHED rows. Do NOT flip to security_invoker.';

revoke all on public.v_public_hotel_sites from anon, authenticated;
grant select on public.v_public_hotel_sites to anon, authenticated;
