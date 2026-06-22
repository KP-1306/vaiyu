// web/src/services/invoiceService.ts
//
// Requests a GST-compliant invoice PDF from the render-invoice edge function and
// returns a signed URL. The function allocates a stable sequential invoice number,
// renders a Tax Invoice (registered hotels) or Bill of Supply (unregistered), and
// stores the PDF. Optional B2B fields (guest GSTIN + business legal name) are
// persisted to the folio and printed on the invoice.
import { supabase } from "../lib/supabase";

export interface InvoiceRequest {
  folioId?: string;
  bookingId?: string;
  gstin?: string;
  legalName?: string;
}

export async function requestInvoice(params: InvoiceRequest): Promise<{ url: string; invoiceNo: string }> {
  const body: Record<string, string> = {};
  if (params.folioId) body.folio_id = params.folioId;
  if (params.bookingId) body.booking_id = params.bookingId;
  if (params.gstin) body.guest_gstin = params.gstin;
  if (params.legalName) body.guest_legal_name = params.legalName;

  const { data, error } = await supabase.functions.invoke("render-invoice", { body });
  if (error) throw new Error(error.message || "invoice_failed");
  if (!data?.ok || !data?.signed_url) throw new Error(data?.code || "invoice_failed");
  return { url: data.signed_url as string, invoiceNo: data.invoice_no as string };
}
