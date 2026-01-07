ALTER TABLE public.sla_policies
ADD COLUMN valid_from timestamptz,
ADD COLUMN valid_to timestamptz;


UPDATE public.sla_policies
SET valid_from = created_at
WHERE valid_from IS NULL;


ALTER TABLE public.sla_policies
ALTER COLUMN valid_from SET NOT NULL;