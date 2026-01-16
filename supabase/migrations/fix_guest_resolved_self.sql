-- ============================================================
-- Fix: Update GUEST_RESOLVED_SELF to allow guests
-- Purpose: The initial migration had a duplicate that prevented
--          guests from seeing this cancel reason.
--          This update fixes permissions AND content.
-- ============================================================

UPDATE public.cancel_reasons
SET
  -- Correct permissions
  allowed_for_guest = TRUE,
  allowed_for_staff = FALSE,
  
  -- Correct content (match guest definition)
  label = 'Resolved by guest',
  description = 'Guest resolved the issue themselves',
  icon = 'check-circle',
  
  -- Ensure correct intent
  intent_category = 'RESOLVED_EXTERNALLY'
WHERE code = 'GUEST_RESOLVED_SELF';
