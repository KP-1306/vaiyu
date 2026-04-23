-- ============================================================
-- FIX: Align Required Onboarding Steps with UI
-- ============================================================

BEGIN;

-- 1. Remove the incorrectly required financial_setup step
DELETE FROM public.hotel_onboarding_required_steps
WHERE step_name = 'financial_setup';

-- 2. Ensure the actual steps completed by the UI are required
INSERT INTO public.hotel_onboarding_required_steps(step_name)
VALUES
    ('staff_setup'),
    ('features')
ON CONFLICT DO NOTHING;

COMMIT;
