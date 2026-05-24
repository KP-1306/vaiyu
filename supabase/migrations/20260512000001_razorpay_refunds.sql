-- 20260512000001_razorpay_refunds.sql
--
-- Adds first-class refund support for Razorpay payments.
--
-- A refund is a new event, not an UPDATE to the original payment. That keeps
-- the existing immutability invariant on `payments` (trg_restrict_payment_update)
-- and supports multiple partial refunds per original payment.
--
-- Lifecycle:
--   1. Staff initiates refund → row inserted with status='PENDING'.
--   2. Edge function razorpay-create-refund calls Razorpay /refund API,
--      records the returned razorpay_refund_id.
--   3. Razorpay webhook delivers refund.processed → status updates to PROCESSED.
--   4. trg_refund_to_folio fires → inserts a folio_entries REFUND row that
--      adds the amount back to the balance owed, mirroring how
--      trg_payment_to_folio handles payment captures.
--
-- Route correctness: refunds are created with `reverse_all: 1` by default
-- (stored as the column default; opt-out via the column). reverse_all = 1
-- pulls money back from the hotel's Linked Account → platform → guest,
-- which is the only correct behaviour for a Route-split payment. Without
-- it, the platform refunds out-of-pocket while the hotel keeps its share.

CREATE TABLE public.refunds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id        UUID NOT NULL REFERENCES public.hotels(id) ON DELETE CASCADE,
  booking_id      UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  folio_id        UUID REFERENCES public.folios(id) ON DELETE SET NULL,
  payment_id      UUID NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,

  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency        TEXT          NOT NULL DEFAULT 'INR',
  reason          TEXT,                         -- staff free-text note
  notes           TEXT,                         -- system / webhook annotations

  status          TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','PROCESSED','FAILED')),

  -- Razorpay reconciliation
  razorpay_refund_id TEXT,
  razorpay_response  JSONB,

  -- Route safety flag: reverse the original transfer so funds come back from
  -- the hotel's Linked Account, not from the platform account.
  reverse_all     BOOLEAN NOT NULL DEFAULT true,

  -- Audit
  initiated_by    UUID,                          -- staff user_id
  initiated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ,
  failed_at       TIMESTAMPTZ,
  failure_reason  TEXT
);

-- Idempotency on the Razorpay refund id (mirrors payments)
CREATE UNIQUE INDEX refunds_razorpay_refund_id_uq
  ON public.refunds (razorpay_refund_id)
  WHERE razorpay_refund_id IS NOT NULL;

CREATE INDEX refunds_payment_id_idx  ON public.refunds (payment_id);
CREATE INDEX refunds_booking_id_idx  ON public.refunds (booking_id);
CREATE INDEX refunds_hotel_id_idx    ON public.refunds (hotel_id);
CREATE INDEX refunds_status_idx      ON public.refunds (status);

-- Trigger: when a refund flips to PROCESSED, append a REFUND folio entry so
-- the guest's balance owed reflects the reversal. Same pattern as
-- trg_payment_to_folio, just opposite sign convention.
CREATE OR REPLACE FUNCTION public.trg_refund_to_folio()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'PROCESSED'
     AND (OLD.status IS DISTINCT FROM 'PROCESSED') THEN
    INSERT INTO public.folio_entries (
      hotel_id, booking_id, folio_id, entry_type, amount,
      description, reference_id
    ) VALUES (
      NEW.hotel_id, NEW.booking_id, NEW.folio_id, 'REFUND',
      NEW.amount,                          -- positive: adds back to balance owed
      'Refund: ' || COALESCE(NEW.reason, 'staff-initiated'),
      NEW.id
    );
    NEW.processed_at := COALESCE(NEW.processed_at, now());
  END IF;

  IF NEW.status = 'FAILED'
     AND (OLD.status IS DISTINCT FROM 'FAILED') THEN
    NEW.failed_at := COALESCE(NEW.failed_at, now());
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER refund_to_folio_before_update
  BEFORE UPDATE OF status ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION public.trg_refund_to_folio();

-- RLS — same model as payments
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage refunds for their hotel"
  ON public.refunds
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hotel_members hm
      WHERE hm.hotel_id = refunds.hotel_id
        AND hm.user_id = auth.uid()
        AND hm.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.hotel_members hm
      WHERE hm.hotel_id = refunds.hotel_id
        AND hm.user_id = auth.uid()
        AND hm.is_active = true
    )
  );

-- Service role (Edge Functions) bypass RLS for webhook-driven updates
CREATE POLICY "Service role full access to refunds"
  ON public.refunds
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE  public.refunds IS 'Refund events against payments. One row per Razorpay refund (including partials).';
COMMENT ON COLUMN public.refunds.reverse_all IS 'When true, the Razorpay refund is sent with reverse_all=1 so the Linked Account is debited. Always true for Route-split payments.';
