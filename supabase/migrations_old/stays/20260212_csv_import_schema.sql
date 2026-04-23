-- Migration: CSV Import Schema & Bookings Update
-- Purpose: Enable bulk CSV ingestion with audit logs and idempotent updates.
-- Final Production Version: Includes concurrency-safe state machine, optimizations, auto-counters, hardening, tenant isolation, and worker performance.

-- 1. Create Import Batches Table (Audit & History)
CREATE TABLE IF NOT EXISTS public.import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    total_rows INT DEFAULT 0,
    imported_rows INT DEFAULT 0,
    error_rows INT DEFAULT 0,
    status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ
);

-- Hardening 3: Composite Unique Index for FK consistency (Tenant Isolation)
CREATE UNIQUE INDEX IF NOT EXISTS idx_import_batches_id_hotel
ON public.import_batches(id, hotel_id);

-- 2. Create Import Rows Table (Row-level status & errors)
CREATE TABLE IF NOT EXISTS public.import_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
    hotel_id UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE, -- Optimization 1: Denormalized
    row_number INT, -- Optimization 2: Operational tracking
    booking_reference TEXT,
    row_data JSONB,
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending', 
        'validating', 
        'valid', 
        'importing', 
        'imported', 
        'notified', 
        'error'
    )), -- Final Production State Machine
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    processed_at TIMESTAMPTZ, -- Optimization 3: Audit & Retries
    updated_at TIMESTAMPTZ DEFAULT now() -- Robustness 1: Debugging delays
);

-- Hardening 3: Tenant Isolation FK
-- Ensures row's hotel_id matches batch's hotel_id
ALTER TABLE public.import_rows
DROP CONSTRAINT IF EXISTS fk_import_rows_batch_hotel;

ALTER TABLE public.import_rows
ADD CONSTRAINT fk_import_rows_batch_hotel
FOREIGN KEY (batch_id, hotel_id)
REFERENCES public.import_batches(id, hotel_id)
ON DELETE CASCADE;

-- 3. Create Hotel Import Mappings (Saved mappings per hotel)
CREATE TABLE IF NOT EXISTS public.hotel_import_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hotel_id UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
    mapping_name TEXT DEFAULT 'default', 
    csv_column TEXT NOT NULL,
    vaiyu_field TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Optimization 5: Better unique constraint for mappings
CREATE UNIQUE INDEX IF NOT EXISTS hotel_import_mappings_unique
ON public.hotel_import_mappings(hotel_id, mapping_name, csv_column);

-- 4. Update Bookings Table (Add missing columns)
DO $$
BEGIN
    -- Email (If missing)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bookings' AND column_name='email') THEN
        ALTER TABLE public.bookings ADD COLUMN email TEXT;
    END IF;

    -- Special Requests
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bookings' AND column_name='special_requests') THEN
        ALTER TABLE public.bookings ADD COLUMN special_requests TEXT;
    END IF;

    -- Room ID
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bookings' AND column_name='room_id') THEN
        ALTER TABLE public.bookings ADD COLUMN room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL;
    END IF;
END $$;


-- 5. RLS Policies
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_import_mappings ENABLE ROW LEVEL SECURITY;

-- Policies for Batches/Rows/Mappings
CREATE POLICY "Hotel staff can manage import mappings" ON public.hotel_import_mappings FOR ALL USING (EXISTS (SELECT 1 FROM public.hotel_members hm WHERE hm.user_id = auth.uid() AND hm.hotel_id = hotel_import_mappings.hotel_id));
CREATE POLICY "Hotel staff can view import batches" ON public.import_batches FOR SELECT USING (EXISTS (SELECT 1 FROM public.hotel_members hm WHERE hm.user_id = auth.uid() AND hm.hotel_id = import_batches.hotel_id));
CREATE POLICY "Hotel staff can create import batches" ON public.import_batches FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.hotel_members hm WHERE hm.user_id = auth.uid() AND hm.hotel_id = import_batches.hotel_id));
CREATE POLICY "Hotel staff can update import batches" ON public.import_batches FOR UPDATE USING (EXISTS (SELECT 1 FROM public.hotel_members hm WHERE hm.user_id = auth.uid() AND hm.hotel_id = import_batches.hotel_id));
CREATE POLICY "Hotel staff can view import rows" ON public.import_rows FOR SELECT USING (EXISTS (SELECT 1 FROM public.hotel_members hm WHERE hm.user_id = auth.uid() AND hm.hotel_id = import_rows.hotel_id));
CREATE POLICY "Hotel staff can create import rows" ON public.import_rows FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.hotel_members hm WHERE hm.user_id = auth.uid() AND hm.hotel_id = import_rows.hotel_id));

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_import_batches_hotel ON public.import_batches(hotel_id);
CREATE INDEX IF NOT EXISTS idx_import_rows_batch ON public.import_rows(batch_id);
CREATE INDEX IF NOT EXISTS idx_import_rows_status ON public.import_rows(status);
CREATE INDEX IF NOT EXISTS idx_import_rows_hotel ON public.import_rows(hotel_id);

-- Hardening 2: Index for history sorting
CREATE INDEX IF NOT EXISTS idx_import_batches_created_at ON public.import_batches(created_at DESC);

-- Optimization 4 & Fix: Unique guard ignoring NULL row_numbers
CREATE UNIQUE INDEX IF NOT EXISTS idx_import_row_unique ON public.import_rows(batch_id, row_number) WHERE row_number IS NOT NULL;

-- Robustness 2: Partial index for pending work (General)
CREATE INDEX IF NOT EXISTS idx_import_rows_pending
ON public.import_rows(batch_id)
WHERE status IN ('pending','valid','importing','validating');

-- Hardening 4: Worker Queue Performance Index
CREATE INDEX IF NOT EXISTS idx_import_rows_pending_worker
ON public.import_rows(status, id)
WHERE status='pending';

-- 7. Triggers

-- Robustness 1: Auto-update updated_at for rows
CREATE OR REPLACE FUNCTION public.set_import_rows_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_import_rows_updated_at ON public.import_rows;
CREATE TRIGGER trg_import_rows_updated_at
BEFORE UPDATE ON public.import_rows
FOR EACH ROW
EXECUTE FUNCTION public.set_import_rows_updated_at();

-- Robustness 3: Automatic batch progress update
CREATE OR REPLACE FUNCTION public.update_batch_counters()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE public.import_batches b
    SET imported_rows = (
        SELECT COUNT(*) FROM public.import_rows r
        WHERE r.batch_id = b.id AND r.status IN ('imported','notified')
    ),
    error_rows = (
        SELECT COUNT(*) FROM public.import_rows r
        WHERE r.batch_id = b.id AND r.status = 'error'
    )
    WHERE b.id = NEW.batch_id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_batch_counters ON public.import_rows;
CREATE TRIGGER trg_update_batch_counters
AFTER UPDATE OF status ON public.import_rows
FOR EACH ROW
EXECUTE FUNCTION public.update_batch_counters();

-- Robustness 4: Batch Auto-Complete Trigger
CREATE OR REPLACE FUNCTION public.complete_batch_if_done()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.import_rows
        WHERE batch_id = NEW.batch_id
        AND status IN ('pending','validating','valid','importing')
    ) THEN
        UPDATE public.import_batches
        SET status='completed',
            completed_at=now()
        WHERE id = NEW.batch_id
          AND status='processing';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_complete_batch ON public.import_rows;
CREATE TRIGGER trg_complete_batch
AFTER UPDATE OF status ON public.import_rows
FOR EACH ROW
EXECUTE FUNCTION public.complete_batch_if_done();

-- Hardening 5: Batch-Scoped Worker Queue Index (Optimization)
CREATE INDEX IF NOT EXISTS idx_import_rows_batch_status_id
ON public.import_rows(batch_id, status, id)
WHERE status='pending';

