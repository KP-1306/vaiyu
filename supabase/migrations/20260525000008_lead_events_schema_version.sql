-- Lead events: schema version for forward compatibility
--
-- Adds an integer schema_version field to every event row. Defaults to 1.
-- All RPCs continue to work unchanged (no SET column needed; default handles it).
--
-- Bump protocol:
--   - DO bump on BREAKING changes: renaming fields, removing fields, changing
--     types, restructuring nested objects. Consumers must branch on version.
--   - DO NOT bump on additive changes: new optional fields. Consumers handle
--     absent fields via optional types.
--
-- The frontend validator (leadService.validateLeadEventPayload) reads this
-- field and refuses to parse payloads whose schema_version exceeds the client's
-- KNOWN_MAX_SCHEMA_VERSION. Future clients can introduce v2 parsing branches
-- without breaking older clients during staged rollouts.

ALTER TABLE public.lead_events
  ADD COLUMN IF NOT EXISTS event_schema_version integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.lead_events.event_schema_version IS
  'Schema version of the payload field. Bump ONLY on breaking changes (renames, type changes, structural restructuring). Additive changes do NOT bump version. Default 1.';
