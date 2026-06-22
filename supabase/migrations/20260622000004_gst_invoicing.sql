-- ============================================================================
-- GST-compliant tax invoicing
-- ============================================================================
-- The guest "Tax Invoice" was a non-compliant window.print: no GSTIN, no
-- sequential invoice number, no CGST/SGST split. This adds the legally-required
-- pieces: a stable per-folio sequential invoice number (atomic, idempotent) and
-- B2B fields. The PDF itself is rendered by the render-invoice edge function;
-- hotels WITHOUT a GSTIN get a "Bill of Supply" (no GST lines) — handled in the
-- function, since claiming tax you didn't collect is illegal.
-- ============================================================================

ALTER TABLE public.folios
  ADD COLUMN IF NOT EXISTS invoice_no         text,
  ADD COLUMN IF NOT EXISTS invoice_issued_at  timestamptz,
  ADD COLUMN IF NOT EXISTS guest_gstin        text,
  ADD COLUMN IF NOT EXISTS guest_legal_name   text;

-- No duplicate invoice numbers within a hotel (backstop for the allocator).
CREATE UNIQUE INDEX IF NOT EXISTS ux_folios_hotel_invoice_no
  ON public.folios (hotel_id, invoice_no) WHERE invoice_no IS NOT NULL;

-- Atomic, idempotent invoice-number allocation. Called by render-invoice
-- (service-role). Locks the folio (idempotent under concurrency) and the hotel
-- row (serial counter), formats <prefix>/<FY>/<NNNN>, and writes it ONCE.
CREATE OR REPLACE FUNCTION public.allocate_invoice_number(p_folio_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hotel_id uuid;
  v_existing text;
  v_prefix   text;
  v_counter  bigint;
  v_fy_start int;
  v_now      timestamptz := now();
  v_y int; v_m int; v_fy1 int; v_fy2 int;
  v_fy text; v_no text;
BEGIN
  -- Lock the folio: a concurrent caller waits, then sees the number and returns it.
  SELECT hotel_id, invoice_no INTO v_hotel_id, v_existing
    FROM public.folios WHERE id = p_folio_id FOR UPDATE;
  IF v_hotel_id IS NULL THEN
    RAISE EXCEPTION 'folio_not_found';
  END IF;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;  -- idempotent
  END IF;

  -- Serialize counter allocation per hotel.
  SELECT coalesce(invoice_prefix, 'INV'), coalesce(invoice_counter, 1), coalesce(financial_year_start_month, 4)
    INTO v_prefix, v_counter, v_fy_start
    FROM public.hotels WHERE id = v_hotel_id FOR UPDATE;

  -- Financial-year label (India default Apr–Mar), e.g. 25-26.
  v_y := extract(year FROM v_now)::int;
  v_m := extract(month FROM v_now)::int;
  v_fy1 := CASE WHEN v_m >= v_fy_start THEN v_y ELSE v_y - 1 END;
  v_fy2 := v_fy1 + 1;
  v_fy := lpad((v_fy1 % 100)::text, 2, '0') || '-' || lpad((v_fy2 % 100)::text, 2, '0');

  v_no := v_prefix || '/' || v_fy || '/' || lpad(v_counter::text, 4, '0');

  UPDATE public.hotels SET invoice_counter = v_counter + 1 WHERE id = v_hotel_id;
  UPDATE public.folios SET invoice_no = v_no, invoice_issued_at = v_now WHERE id = p_folio_id;
  RETURN v_no;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_invoice_number(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_invoice_number(uuid) TO service_role;

-- Private bucket for the rendered invoice PDFs (served via signed URLs).
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoice-pdfs', 'invoice-pdfs', false)
ON CONFLICT (id) DO NOTHING;
