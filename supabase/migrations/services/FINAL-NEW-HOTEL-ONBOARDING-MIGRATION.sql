ALTER TABLE tickets
    ADD COLUMN service_id UUID NULL
REFERENCES services(id);

ALTER TABLE tickets
    ALTER COLUMN service_id SET NOT NULL;


UPDATE tickets t
SET service_id = s.id
    FROM services s
WHERE
    t.service_id IS NULL
  AND t.title = s.label
  AND s.hotel_id = t.hotel_id;


ALTER TABLE tickets
DROP CONSTRAINT IF EXISTS tickets_service_id_fkey;

ALTER TABLE tickets
    ADD CONSTRAINT tickets_service_id_fkey
        FOREIGN KEY (service_id)
            REFERENCES services(id)
            ON DELETE RESTRICT;



----When you later move to service-specific SLA:

ALTER TABLE sla_policies ADD COLUMN service_id UUID;