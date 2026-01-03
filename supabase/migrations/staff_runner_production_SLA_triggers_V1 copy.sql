   -- ==========================================================
  -- ✅ Trigger A: Start SLA based on policy
  -- Fires when:

  -- Ticket created

  -- Ticket assigned

  -- Shift starts (optional)

  -- Example: START SLA on ASSIGN (policy-aware)
  -- ==========================================================
  CREATE OR REPLACE FUNCTION trg_start_sla_on_assign()
RETURNS trigger AS $$
DECLARE
  start_policy TEXT;
BEGIN
  SELECT sla_start_trigger
  INTO start_policy
  FROM sla_policies
  WHERE department_id = NEW.service_department_id
    AND is_active = true;

  IF start_policy = 'ON_ASSIGN'
     AND NEW.current_assignee_id IS NOT NULL
     AND OLD.current_assignee_id IS NULL THEN

    UPDATE ticket_sla_state
    SET
      sla_started_at = now(),
      sla_resumed_at = now()
    WHERE ticket_id = NEW.id
      AND sla_started_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER start_sla_on_assign
AFTER UPDATE OF current_assignee_id ON tickets
FOR EACH ROW
EXECUTE FUNCTION trg_start_sla_on_assign();


-- ==========================================================
  --
--✅ Trigger B: Pause SLA on BLOCKED (policy-aware)
  --
 -- ==========================================================
 
CREATE OR REPLACE FUNCTION trg_pause_sla_on_block()
RETURNS trigger AS $$
DECLARE
  pauses BOOLEAN;
BEGIN
  SELECT pauses_sla
  INTO pauses
  FROM block_reasons
  WHERE code = NEW.reason_code;

  IF pauses = true
     AND NEW.status = 'BLOCKED'
     AND OLD.status <> 'BLOCKED' THEN

    UPDATE ticket_sla_state
    SET sla_paused_at = now()
    WHERE ticket_id = NEW.id
      AND sla_paused_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER pause_sla_on_block
AFTER UPDATE OF status ON tickets
FOR EACH ROW
WHEN (
  NEW.status = 'BLOCKED'
  AND OLD.status IS DISTINCT FROM NEW.status
)
EXECUTE FUNCTION trg_pause_sla_on_block();



-- ==========================================================
  --
--✅ Trigger C: Resume SLA on UNBLOCK
  --
 -- ==========================================================
 

CREATE OR REPLACE FUNCTION trg_resume_sla_on_unblock()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'BLOCKED'
     AND NEW.status = 'IN_PROGRESS' THEN

    UPDATE ticket_sla_state
    SET
      total_paused_seconds =
        total_paused_seconds +
        EXTRACT(EPOCH FROM (now() - sla_paused_at))::INT,
      sla_paused_at = NULL,
      sla_resumed_at = now()
    WHERE ticket_id = NEW.id
      AND sla_paused_at IS NOT NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER resume_sla_on_unblock
AFTER UPDATE OF status ON tickets
FOR EACH ROW
WHEN (
  OLD.status = 'BLOCKED'
  AND NEW.status = 'IN_PROGRESS'
)
EXECUTE FUNCTION trg_resume_sla_on_unblock();

-- ==========================================================
  --
--2️⃣ Background job — what it SHOULD do
--Responsibility:

--Compute time remaining & breach

--This must be outside triggers.

--✅ Periodic SLA updater (every 30–60 sec)

--Pseudo-logic:

UPDATE ticket_sla_state
SET current_remaining_seconds =
  GREATEST(
    (sp.target_minutes * 60)
    - EXTRACT(EPOCH FROM (now() - sla_started_at))::INT
    - total_paused_seconds,
    0
  )
FROM tickets t
JOIN sla_policies sp
  ON sp.department_id = t.service_department_id
WHERE ticket_sla_state.ticket_id = t.id
  AND sla_started_at IS NOT NULL
  AND breached = false;

--✅ Breach detector job
UPDATE ticket_sla_state
SET
  breached = true,
  breached_at = now()
WHERE breached = false
  AND current_remaining_seconds <= 0
  AND sla_started_at IS NOT NULL;


--✔ Runs fast
--✔ Scales horizontally
✔ No lock contention

--3️⃣ View — final authority for UI

--Your view already does this correctly:

--sla_state

--sla_label

--no frontend math

--This is perfect.

--4️⃣ Why this approach is BEST (not opinion)
--✔ Correctness

--SLA cannot be skipped

--Policy always enforced

--✔ Performance

--No heavy trigger math

--No write amplification

--✔ Debuggability

--SLA logic visible & testable

--Jobs can be replayed

--✔ Scalability

--Works at 100 tickets or 10M tickets


----Combined update query job
WITH updated AS (
  UPDATE ticket_sla_state ss
  SET
    current_remaining_seconds =
      GREATEST(
        (sp.target_minutes * 60)
        - EXTRACT(EPOCH FROM (now() - ss.sla_started_at))::INT
        - ss.total_paused_seconds,
        0
      )
  FROM tickets t, sla_policies sp
  WHERE ss.ticket_id = t.id
    AND sp.id = ss.sla_policy_id      -- ✅ moved here (Postgres-legal)
    AND ss.sla_started_at IS NOT NULL
    AND ss.breached = false
  RETURNING ss.ticket_id, current_remaining_seconds
)
UPDATE ticket_sla_state
SET
  breached = true,
  breached_at = now()
WHERE ticket_id IN (
  SELECT ticket_id
  FROM updated
  WHERE current_remaining_seconds <= 0
)
AND breached = false;
