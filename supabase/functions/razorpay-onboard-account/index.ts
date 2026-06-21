// supabase/functions/razorpay-onboard-account/index.ts
//
// POST: creates a Razorpay Route Linked Account for a hotel by calling
// Razorpay's POST /v2/accounts API and stores the returned `acc_xxx` on
// `hotels.razorpay_account_id`.
//
// Why this exists: without it, the owner has to manually click through the
// Razorpay dashboard to create a Linked Account per hotel. With it, they get
// an in-app "Connect with Razorpay" button.
//
// Test mode vs Live mode (no code changes):
//   - Test mode: Razorpay creates an inactive sub-account that's immediately
//     usable for transfers[] without KYC. Perfect for development.
//   - Live mode: Razorpay creates the account and returns a KYC URL the
//     hotel must complete before they can accept real money. We surface
//     this URL in the response so the owner can finish onboarding.
//
// Auth: user JWT, owner role on the hotel.
// Inputs: { hotel_id }
// Outputs:
//   {
//     ok: true,
//     account_id: "acc_xxx",
//     status: "created" | "activated",
//     activation_url?: string   // only in live mode when KYC is pending
//   }

import { serve as __serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { withObs as __withObs } from "../_shared/http-telemetry.ts";
const serve = (h: (req: Request) => Response | Promise<Response>) => __serve(__withObs("razorpay-onboard-account", h));
import {
  CORS_HEADERS,
  json,
  preflight,
  assertAuthed,
  supabaseAnon,
  supabaseService,
  rateLimitForUser,
  tooManyRequests,
} from "../_shared/auth.ts";
import { razorpayBasicAuth } from "../_shared/razorpay.ts";
import { logError, logInfo } from "../_shared/observability.ts";

const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
const RAZORPAY_API_BASE_V2 = "https://api.razorpay.com/v2";

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  logError("razorpay-onboard-account.boot", new Error("Razorpay credentials missing"));
}

type OnboardBody = {
  hotel_id?: string;
  // Optional override fields if the hotel record is incomplete
  bank_account_number?: string;
  bank_ifsc?: string;
  bank_beneficiary_name?: string;
  pan?: string;
  business_type?: "proprietorship" | "individual" | "private_limited" | "partnership" | "llp" | "trust" | "society" | "ngo";
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // 1. Auth
  const authed = await assertAuthed(req);
  if (authed instanceof Response) return authed;
  const { user } = authed;

  // 2. Body
  let body: OnboardBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  if (!body.hotel_id) return json(400, { error: "hotel_id required" });

  // 3. RBAC: only finance manager / owner can configure payments
  const sbAnon = supabaseAnon(req);
  const { data: canAuthorize, error: rbacErr } = await sbAnon.rpc(
    "vaiyu_is_hotel_finance_manager",
    { p_hotel_id: body.hotel_id },
  );
  if (rbacErr) return json(500, { error: "Authorization check failed" });
  if (canAuthorize !== true) {
    return json(403, { error: "Forbidden: finance manager role required" });
  }

  // 3a. Rate limit — onboarding is a rare, deliberate action. 5/minute is
  //     plenty for an owner who's retrying, and stops accidental spam.
  const svcForLimit = supabaseService();
  const limit = await rateLimitForUser(svcForLimit, user.id, "razorpay-onboard-account", 5);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSec);

  // 4. Pull hotel data to seed the onboarding payload
  const svc = supabaseService();
  const { data: hotel, error: hErr } = await svc
    .from("hotels")
    .select(
      "id, slug, name, legal_name, email, phone, address, city, state, postal_code, gst_number, razorpay_account_id, upi_id",
    )
    .eq("id", body.hotel_id)
    .maybeSingle();
  if (hErr || !hotel) return json(404, { error: "Hotel not found" });

  if (hotel.razorpay_account_id) {
    return json(409, {
      error: "Hotel already has a Linked Account",
      code: "ALREADY_LINKED",
      account_id: hotel.razorpay_account_id,
    });
  }

  // 5. Build the Razorpay /v2/accounts request
  // Schema reference: https://razorpay.com/docs/api/partners/account-onboarding/
  // Required fields per Razorpay: email, phone, type='route', legal_business_name,
  // business_type, contact_name, profile.category, profile.subcategory.
  // Optional but recommended for KYC pre-fill: profile.addresses, legal_info,
  // brand, contact_info.
  if (!hotel.email || !hotel.phone) {
    return json(412, {
      error: "Hotel email and phone are required before onboarding",
      code: "MISSING_HOTEL_CONTACT",
    });
  }

  const requestBody: Record<string, unknown> = {
    email: hotel.email,
    phone: String(hotel.phone).replace(/[^0-9]/g, "").slice(-10),
    type: "route",
    reference_id: hotel.slug, // for our own dashboard reconciliation
    legal_business_name: (hotel.legal_name || hotel.name).slice(0, 200),
    business_type: body.business_type ?? "proprietorship",
    customer_facing_business_name: hotel.name,
    profile: {
      category: "ecommerce",
      subcategory: "hospitality",
      addresses: hotel.address
        ? {
          registered: {
            street1: hotel.address.slice(0, 100),
            street2: "",
            city: hotel.city ?? "Bangalore",
            // Razorpay expects uppercase state names (e.g. KARNATAKA)
            state: (hotel.state ?? "KARNATAKA").toUpperCase(),
            postal_code: hotel.postal_code ?? "560001",
            country: "IN",
          },
        }
        : undefined,
    },
    contact_name: (hotel.legal_name || hotel.name).slice(0, 100),
  };

  if (hotel.gst_number) {
    requestBody.legal_info = { gst: hotel.gst_number };
  }

  // 6. Call Razorpay
  let createRes: Response;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    createRes = await fetch(`${RAZORPAY_API_BASE_V2}/accounts`, {
      method: "POST",
      headers: {
        Authorization: razorpayBasicAuth(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch (e) {
    logError("razorpay-onboard-account.network", e, { hotel_id: body.hotel_id });
    return json(504, { error: "Razorpay timed out creating the account" });
  }

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => "");
    logError("razorpay-onboard-account.rejected", new Error(`Razorpay returned ${createRes.status}`), {
      hotel_id: body.hotel_id,
      status: createRes.status,
      response: errText.slice(0, 500),
    });
    let safeMsg = "Razorpay rejected the onboarding request";
    let code = "ONBOARD_FAILED";
    try {
      const parsed = JSON.parse(errText);
      if (parsed?.error?.description) safeMsg = parsed.error.description;
      if (parsed?.error?.code) code = parsed.error.code;
    } catch {
      // ignore
    }
    return json(502, { error: safeMsg, code, status: createRes.status });
  }

  const account = await createRes.json();
  const accountId: string = account.id;
  if (!accountId || !accountId.startsWith("acc_")) {
    logError("razorpay-onboard-account.bad_response", new Error("Invalid account id from Razorpay"), {
      hotel_id: body.hotel_id,
      received: typeof accountId === "string" ? accountId.slice(0, 40) : typeof accountId,
    });
    return json(502, { error: "Razorpay returned invalid account id" });
  }

  // 7. Persist on the hotel row
  const { error: updErr } = await svc
    .from("hotels")
    .update({ razorpay_account_id: accountId })
    .eq("id", body.hotel_id);
  if (updErr) {
    logError("razorpay-onboard-account.persist_failed", updErr, {
      hotel_id: body.hotel_id,
      account_id: accountId,
    });
    return json(500, {
      error: "Account created at Razorpay but could not be saved locally",
      account_id: accountId,
      hint: "Please paste the account_id manually in settings",
    });
  }

  logInfo("razorpay-onboard-account.created", "Linked Account created", {
    hotel_id: body.hotel_id,
    account_id: accountId,
    status: account.status ?? "created",
    needs_kyc: !!account.activation_url,
  });

  // 8. Return result. In live mode Razorpay returns an `activation_url` until
  //    KYC is complete; surface that to the client so the owner can finish.
  return new Response(
    JSON.stringify({
      ok: true,
      account_id: accountId,
      status: account.status ?? "created",
      activation_url: account.activation_url ?? null,
      created_by_user_id: user.id,
    }),
    { status: 200, headers: CORS_HEADERS },
  );
});
