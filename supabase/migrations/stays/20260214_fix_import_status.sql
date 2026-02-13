-- Ensure status constraint includes all necessary states
ALTER TABLE public.import_rows
DROP CONSTRAINT IF EXISTS import_rows_status_check;

ALTER TABLE public.import_rows
ADD CONSTRAINT import_rows_status_check
CHECK (status IN (
    'pending',
    'validating',
    'valid',
    'importing',
    'imported',
    'notified',
    'error'
));

-- Ensure indexes exist for performance (idempotent)
CREATE INDEX IF NOT EXISTS idx_import_rows_process_queue
ON public.import_rows(batch_id, status)
WHERE status = 'pending';
