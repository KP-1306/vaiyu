// web/src/services/stayExtensionService.ts
// Stay extension workflow — guest requests, staff approves/rejects.

import { supabase } from "../lib/supabase";
import { PricingServiceError } from "./pricingService";

export type ExtensionStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface StayExtensionRequest {
  id: string;
  hotel_id: string;
  stay_id: string;
  booking_id: string;
  guest_id: string | null;
  current_checkout_at: string;
  requested_checkout_at: string;
  additional_nights: number;
  status: ExtensionStatus;
  guest_note: string | null;
  staff_note: string | null;
  requested_by_user: string | null;
  requested_by_source: "guest" | "staff";
  requested_at: string;
  reviewed_by_user: string | null;
  reviewed_at: string | null;
  additional_amount: number | null;
  folio_entry_id: string | null;
}

function wrap(err: unknown): PricingServiceError {
  if (err instanceof PricingServiceError) return err;
  const e = err as { code?: string; message?: string };
  const msg = e?.message ?? "Unexpected error";
  if (e?.code === "PGRST116") return new PricingServiceError("not_found", msg, err);
  if (e?.code === "42501") return new PricingServiceError("permission_denied", msg, err);
  if (e?.code === "23505" || e?.code === "40001")
    return new PricingServiceError("conflict", msg, err);
  if (typeof msg === "string" && /network|fetch/i.test(msg))
    return new PricingServiceError("network", msg, err);
  return new PricingServiceError("unknown", msg, err);
}

// Guest-facing: request to extend my own stay (or staff-on-behalf).
// `requestedCheckoutDate` must be a YYYY-MM-DD string after the current
// scheduled checkout date. Returns the extension request id.
export async function requestStayExtension(params: {
  stayId: string;
  requestedCheckoutDate: string;
  guestNote?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("request_stay_extension", {
    p_stay_id: params.stayId,
    p_requested_checkout_date: params.requestedCheckoutDate,
    p_guest_note: params.guestNote ?? null,
  });
  if (error) throw wrap(error);
  if (typeof data !== "string") throw new PricingServiceError("unknown", "Unexpected RPC payload");
  return data;
}

// Staff-facing: approve. `additionalAmount` is the gross room charge
// that will be posted as a ROOM_CHARGE folio entry. Pass null/undefined
// to waive the charge (extension granted at no cost).
export async function approveStayExtension(params: {
  requestId: string;
  additionalAmount?: number | null;
  staffNote?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("approve_stay_extension", {
    p_request_id: params.requestId,
    p_additional_amount: params.additionalAmount ?? null,
    p_staff_note: params.staffNote ?? null,
  });
  if (error) throw wrap(error);
  if (typeof data !== "string") throw new PricingServiceError("unknown", "Unexpected RPC payload");
  return data;
}

export async function rejectStayExtension(params: {
  requestId: string;
  staffNote?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("reject_stay_extension", {
    p_request_id: params.requestId,
    p_staff_note: params.staffNote ?? null,
  });
  if (error) throw wrap(error);
  if (typeof data !== "string") throw new PricingServiceError("unknown", "Unexpected RPC payload");
  return data;
}

// Guest can withdraw their own pending request; staff can cancel any
// pending request on their hotel. Server enforces both checks.
export async function cancelStayExtension(requestId: string): Promise<string> {
  const { data, error } = await supabase.rpc("cancel_stay_extension", {
    p_request_id: requestId,
  });
  if (error) throw wrap(error);
  if (typeof data !== "string") throw new PricingServiceError("unknown", "Unexpected RPC payload");
  return data;
}

// Staff: list pending extensions for the front-desk approval card.
export async function listPendingExtensions(
  hotelId: string,
): Promise<StayExtensionRequest[]> {
  const { data, error } = await supabase
    .from("stay_extension_requests")
    .select("*")
    .eq("hotel_id", hotelId)
    .eq("status", "pending")
    .order("requested_at", { ascending: true });
  if (error) throw wrap(error);
  return (data ?? []) as StayExtensionRequest[];
}

// Guest: my extension history for a given stay (most-recent first).
// Useful for showing "Your previous extension was approved/rejected" status.
export async function listExtensionsForStay(
  stayId: string,
): Promise<StayExtensionRequest[]> {
  const { data, error } = await supabase
    .from("stay_extension_requests")
    .select("*")
    .eq("stay_id", stayId)
    .order("requested_at", { ascending: false });
  if (error) throw wrap(error);
  return (data ?? []) as StayExtensionRequest[];
}
