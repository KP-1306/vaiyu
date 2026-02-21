-- ============================================================
-- PAYMENTS MODULE (Master Ledger)
-- ============================================================

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    hotel_id UUID NOT NULL REFERENCES hotels(id),
    booking_id UUID NOT NULL REFERENCES bookings(id),
    folio_id UUID REFERENCES folios(id),

    amount NUMERIC(12,2) NOT NULL,
    currency TEXT DEFAULT 'INR',

    method TEXT NOT NULL CHECK (
        method IN (
            'CASH',
            'UPI',
            'CARD',
            'BANK_TRANSFER',
            'WALLET',
            'OTHER'
        )
    ),

    status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (
        status IN (
            'PENDING',
            'COMPLETED',
            'FAILED',
            'REFUNDED'
        )
    ),

    reference_id TEXT,
  notes TEXT,

    collected_by UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Trigger for updated_at
CREATE TRIGGER trg_payments_updated
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Policy 1: Staff/Owners can manage payments for their hotel
CREATE POLICY "Staff manage payments" ON payments
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM bookings b
    JOIN hotel_members hm ON hm.hotel_id = b.hotel_id
    WHERE b.id = payments.booking_id
    AND hm.user_id = auth.uid()
  )
);
DROP POLICY if exists "Guests view own payments" ON payments;
-- Policy 2: Guests can view their own payments
CREATE POLICY "Guests view own payments" ON payments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.id = payments.booking_id
    AND b.guest_id = auth.uid()
  )
);

-- Policy 3: Allow public view if they have the booking code (similar to food orders)
-- This is needed for the Guest App which might access via implicit permission or if we want to be stricter, only auth guests.
-- For now, `resolve_stay_by_code` is public, but accessing the table directly via RLS usually requires auth.
-- However, if the Guest App uses the `supabase` client with a token (anon or guest auth), it depends.
-- Unlike food_orders which has "Public view food orders" USING (true), we should probably be careful.
-- But wait, `GuestOrderHistory` runs in the client. If the user is not authenticated as a 'guest' user (which they might not be, just using local storage code),
-- we might need a securer way or open RLS. 
-- Given `food_orders` allowed public SELECT, we'll follow that pattern for now but strictly scoped to the stay ID check if possible.
-- Actually `food_orders` just said `USING (true)`. That's very open.
-- Let's stick to the authenticated guest policy for now. If the guest app fails (because it's just anon), we might need to open it or rely on an RPC.
-- But wait, `GuestOrderHistory` fetches orders. If `food_orders` is public, `payments` might need to be too for the fetch to work from anon client.
-- Let's replicate the `food_orders` pattern for SELECT to avoid breakage, but maybe relying on the fact that you need the UUID to query it effectively?
-- Without a restrictive USING clause, anyone can list all payments. That's bad.
-- `food_orders` has `USING (true)`. That effectively makes it public.
-- I will maintain consistency with `food_orders` policy for now for SELECT, but maybe we should rely on an RPC for the guest view to be cleaner?
-- No, let's create a "Public view payments" policy but maybe restrict it?
-- Actually, let's check `food_orders` again.
-- `CREATE POLICY "Public view food orders" ON food_orders FOR SELECT USING (true);`
-- This allows listing ALL orders. That is a security risk if someone guesses IDs or lists all.
-- But it's what exists. I will match it for `payments` SELECT only, to ensure the frontend works without auth issues.
-- Ideally we fix both later to check `booking_code` via a join, but `stays` RLS might block that join if not careful.

DROP POLICY if exists "Public view payments" ON payments;

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE payments;

CREATE TABLE folio_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    hotel_id UUID NOT NULL REFERENCES hotels(id),
    booking_id UUID NOT NULL REFERENCES bookings(id),
    folio_id UUID NOT NULL REFERENCES folios(id),

    entry_type TEXT NOT NULL CHECK (
        entry_type IN (
            'ROOM_CHARGE',
            'FOOD_CHARGE',
            'SERVICE_CHARGE',
            'TAX',
            'PAYMENT',
            'REFUND',
            'ADJUSTMENT'
        )
    ),

    amount NUMERIC(12,2) NOT NULL,
    description TEXT,
    reference_id UUID,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_folio_entries_booking ON folio_entries(booking_id);
CREATE INDEX idx_folio_entries_folio ON folio_entries(folio_id);
