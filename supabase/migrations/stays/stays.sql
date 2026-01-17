create table public.stays (
                              id uuid not null default gen_random_uuid (),
                              hotel_id uuid not null,
                              guest_id uuid not null,
                              source text not null default 'walk_in'::text,
                              status public.stay_status not null default 'arriving'::stay_status,
                              check_in_start timestamp with time zone not null default now(),
                              check_out_end timestamp with time zone null,
                              created_at timestamp with time zone not null default now(),
                              updated_at timestamp with time zone not null default now(),
                              is_vip boolean not null default false,
                              vip_level text null,
                              has_open_complaint boolean not null default false,
                              needs_courtesy_call boolean not null default false,
                              room_id uuid not null,
                              is_active boolean GENERATED ALWAYS as (
                                  (
                                      status = any (
                                                    array['arriving'::stay_status, 'inhouse'::stay_status]
                                          )
                                      )
                                  ) STORED null,
                              booking_code text null,
                              constraint stays_pkey primary key (id),
                              constraint stays_guest_id_fkey foreign KEY (guest_id) references guests (id) on delete RESTRICT,
                              constraint stays_hotel_id_fkey foreign KEY (hotel_id) references hotels (id) on delete CASCADE,
                              constraint stays_room_id_fkey foreign KEY (room_id) references rooms (id) on delete RESTRICT,
                              constraint stay_checkout_after_checkin check (
                                  (
                                      (check_out_end is null)
                                          or (check_out_end > check_in_start)
                                      )
                                  ),
                              constraint stays_source_check check (
                                  (
                                      source = any (
                                                    array['walk_in'::text, 'pms_sync'::text, 'manual'::text]
                                          )
                                      )
                                  )
) TABLESPACE pg_default;

create unique INDEX IF not exists stays_unique_open on public.stays using btree (guest_id, hotel_id) TABLESPACE pg_default
    where
    (
    status = any (
    array['arriving'::stay_status, 'inhouse'::stay_status]
    )
    );

create index IF not exists stays_lookup_idx on public.stays using btree (guest_id, hotel_id, status, check_in_start) TABLESPACE pg_default;

create index IF not exists stays_guest_id_idx on public.stays using btree (guest_id) TABLESPACE pg_default;

create index IF not exists stays_check_in_start_idx on public.stays using btree (check_in_start) TABLESPACE pg_default;

create unique INDEX IF not exists stays_booking_code_unique on public.stays using btree (booking_code) TABLESPACE pg_default
    where
    (booking_code is not null);

create trigger validate_stay_room_hotel BEFORE INSERT
    or
update on stays for EACH row
    execute FUNCTION trg_validate_stay_room_hotel ();