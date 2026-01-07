--------------------------------------------------------
-- 8️⃣ Create departments for new hotel
--------------------------------------------------------
INSERT INTO public.departments (
    hotel_id,
    template_id,
    name,
    code,
    is_custom,
    is_active,
    display_order
)
SELECT
    :hotel_id, -- use the hotel id here '8c0e6d1a-3c5e-4d4f-a8f9-1c9d6c1a2b33',
    dt.id,
    dt.name,
    dt.code,
    false,
    true,
    dt.display_order
FROM public.department_templates dt
WHERE dt.is_active = true;


--------------------------------------------------------
-- 9️⃣ Create SLA policies from template defaults
--------------------------------------------------------
INSERT INTO public.sla_policies (
    department_id,
    target_minutes,
    warn_minutes,
    escalate_minutes,
    sla_start_trigger,
    is_active
)
SELECT
    d.id,
    dt.default_target_minutes,
    dt.default_warn_minutes,
    dt.default_escalate_minutes,
    dt.default_sla_start_trigger,
    true
FROM public.departments d
         JOIN public.department_templates dt
              ON dt.id = d.template_id
WHERE d.hotel_id = :hotel_id;
