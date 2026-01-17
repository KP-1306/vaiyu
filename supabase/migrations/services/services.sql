create table public.services (
                                 id uuid not null default gen_random_uuid (),
                                 hotel_id uuid null,
                                 key text not null,
                                 label text not null,
                                 sla_minutes integer null default 30,
                                 active boolean null default true,
                                 priority_weight integer not null default 0,
                                 created_at timestamp with time zone not null default now(),
                                 updated_at timestamp with time zone not null default now(),
                                 label_en text null,
                                 department_id uuid null,
                                 template_id uuid null,
                                 is_custom boolean not null default false,
                                 constraint services_pkey primary key (id),
                                 constraint services_hotel_key_unique unique (hotel_id, key),
                                 constraint services_department_id_fkey foreign KEY (department_id) references departments (id),
                                 constraint services_hotel_fk foreign KEY (hotel_id) references hotels (id) on delete CASCADE deferrable initially DEFERRED,
                                 constraint services_hotel_id_fkey foreign KEY (hotel_id) references hotels (id) on delete CASCADE,
                                 constraint services_template_id_fkey foreign KEY (template_id) references service_templates (id)
) TABLESPACE pg_default;

create index IF not exists idx_services_hotel on public.services using btree (hotel_id) TABLESPACE pg_default;

create index IF not exists idx_services_hotel_active on public.services using btree (hotel_id, active) TABLESPACE pg_default;

create unique INDEX IF not exists services_hotel_key_uniq on public.services using btree (hotel_id, key) TABLESPACE pg_default;

create index IF not exists services_hotel_active_idx on public.services using btree (hotel_id, active) TABLESPACE pg_default;

create index IF not exists idx_services_hotel_key on public.services using btree (hotel_id, key) TABLESPACE pg_default;

create index IF not exists idx_services_department on public.services using btree (department_id) TABLESPACE pg_default;

create trigger trg_services_set_updated_at BEFORE
    update on services for EACH row
    execute FUNCTION set_updated_at ();