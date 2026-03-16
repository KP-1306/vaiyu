import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { allowCors } from "../_shared/cors.ts";

// Helper for structured errors
function buildErrorResponse(code: string, message: string, status: number, req: Request) {
    return new Response(
        JSON.stringify({ error: { code, message } }),
        { status, headers: { ...allowCors(req), "Content-Type": "application/json" } }
    );
}

// Helper to extract true client IP
function getClientIp(req: Request): string | null {
    const forwardedFor = req.headers.get("x-forwarded-for");
    if (forwardedFor) {
        // x-forwarded-for can be a comma-separated list of IPs, the first is the original client
        return forwardedFor.split(',')[0].trim();
    }
    return req.headers.get("x-real-ip") || null;
}

const MIME_MAP: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    pdf: "application/pdf"
};

const ALLOWED_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf"
];

// @ts-ignore
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
// @ts-ignore
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Admin client: skips RLS for fetching raw path, logging audit, and signing URL
// Initialized outside serve() to leverage Edge Runtime instance reuse
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

serve(async (req: Request) => {
    // 1. Handle CORS
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: allowCors(req) });
    }

    // 1b. Lightweight Guard: Block random probes
    const origin = req.headers.get("origin") || "";
    const isAllowedOrigin = origin.includes("vaiyu.co.in") || origin.includes("localhost") || origin.includes("127.0.0.1") || origin.startsWith("http://192.168.");
    
    // LOGGING for debugging
    console.log(`[get-document-url] Request from Origin: ${origin}, Allowed: ${isAllowedOrigin}`);

    if (!isAllowedOrigin && origin !== "") { // Allow empty origin for server-to-server but block mismatch
        return buildErrorResponse("FORBIDDEN", `Invalid origin: ${origin}`, 403, req);
    }

    try {
        let body;
        try {
            body = await req.json();
        } catch {
            return buildErrorResponse("BAD_REQUEST", "Invalid JSON body", 400, req);
        }
        const { guest_id, side = "front", token } = body;

        if (!guest_id || !/^[0-9a-fA-F-]{36}$/.test(guest_id)) {
            return buildErrorResponse("BAD_REQUEST", "Invalid or missing guest_id", 400, req);
        }

        if (side !== "front" && side !== "back") {
            return buildErrorResponse("BAD_REQUEST", "Invalid side", 400, req);
        }

        // 2. Auth Context Setup
        let callerId: string | null = null;
        let authorized = false;
        let logHotelId: string | null = null;
        let logBookingId: string | null = null;

        // Extract true client IP
        const ipAddress = getClientIp(req);

        // 3. Authorization (Token vs Staff)
        const authHeader = req.headers.get("Authorization")?.trim();

        if (token) {
            // Flow A: Precheckin Token (guest self-view)
            // Push guest_id filter directly into the DB query for maximum efficiency
            const { data: validTokens, error: tokenError } = await supabaseAdmin
                .from("precheckin_tokens")
                .select("booking_id, bookings!inner(guest_id, hotel_id)")
                .eq("token", token)
                .eq("bookings.guest_id", guest_id)
                .gt("expires_at", new Date().toISOString())
                .limit(1);

            if (tokenError || !validTokens || validTokens.length === 0) {
                console.error("Token invalid, expired, or unauthorized:", token);
                return buildErrorResponse("UNAUTHORIZED", "Invalid, expired, or unauthorized token", 401, req);
            }

            const tokenRec = validTokens[0];

            authorized = true;
            logBookingId = tokenRec.booking_id;
            // @ts-ignore
            logHotelId = tokenRec.bookings?.hotel_id;
            console.log(`[get-document-url] Authorized via Token: ${token}, Booking: ${logBookingId}`);
        } else {
            // Flow B: Authenticated Staff
            if (!authHeader) {
                return buildErrorResponse("UNAUTHORIZED", "Authorization header missing. Are you logged in?", 401, req);
            }

            try {
                // Extract raw JWT from "Bearer <token>" and verify it with the admin client
                // This is the recommended Supabase Edge Function pattern
                const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
                const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(jwt);

                if (authError || !user) {
                    console.error("Supabase Auth Error:", authError);
                    return buildErrorResponse("UNAUTHORIZED", `Authentication failed: ${authError?.message || "User session not found"}`, 401, req);
                }

                callerId = user.id;

                // Check if user is viewing their OWN documents (Guest Self-View)
                if (callerId === guest_id) {
                    authorized = true;
                } else {
                    // Authenticated Staff: Verify if caller manages a hotel where guest has had a booking.
                    // We split this into two queries to avoid "relationship not found" errors (PGRST204)
                    // since hotel_members and bookings are related via hotels, not directly.

                    // 1. Get IDs of hotels where this user is an active member
                    const { data: hotels, error: hotelError } = await supabaseAdmin
                        .from("hotel_members")
                        .select("hotel_id")
                        .eq("user_id", callerId)
                        .eq("is_active", true)
                        .in("role", ["OWNER", "MANAGER", "STAFF"]);

                    if (hotelError || !hotels || hotels.length === 0) {
                        console.error(`[get-document-url] No active hotel membership for Staff: ${callerId}`, hotelError);
                        return buildErrorResponse("FORBIDDEN", "Access Denied: No active hotel membership found", 403, req);
                    }

                    const hotelIds = hotels.map((h: { hotel_id: string }) => h.hotel_id);

                    // 2. Check if the guest has EVER had a booking at ANY of these hotels
                    const { data: guestCheck, error: guestError } = await supabaseAdmin
                        .from("bookings")
                        .select("id, hotel_id")
                        .in("hotel_id", hotelIds)
                        .eq("guest_id", guest_id)
                        .limit(1);

                    if (guestError || !guestCheck || guestCheck.length === 0) {
                        console.error(`[get-document-url] Authorization Failed. Staff: ${callerId}, Guest: ${guest_id}, Error:`, guestError);
                        return buildErrorResponse("FORBIDDEN", `Access Denied: No managing hotel found for guest ${guest_id}`, 403, req);
                    }

                    logHotelId = guestCheck[0].hotel_id;
                    logBookingId = guestCheck[0].id;
                    authorized = true;
                    console.log(`[get-document-url] Authorized Staff: ${callerId} for Guest: ${guest_id}, Hotel: ${logHotelId}`);
                }

                // Rate Limiting Check (10 views per minute per staff for this SPECIFIC guest)
                try {
                    const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
                    const { count, error: countError } = await supabaseAdmin
                        .from("identity_document_views")
                        .select("id", { count: 'exact', head: true })
                        .eq("staff_user_id", callerId)
                        .eq("guest_id", guest_id)
                        .gte("viewed_at", oneMinuteAgo);

                    if (countError) {
                         console.warn("[get-document-url] Rate limit check query failed (non-blocking):", countError);
                    } else if (count !== null && count >= 10) {
                        console.warn(`[get-document-url] Rate Limited: Staff ${callerId} viewed Guest ${guest_id} too many times.`);
                        return new Response(
                            JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many requests for this document. Please wait a minute." } }),
                            { 
                                status: 429, 
                                headers: { 
                                    ...allowCors(req), 
                                    "Content-Type": "application/json",
                                    "Retry-After": "60" 
                                } 
                            }
                        );
                    }
                } catch (rlErr) {
                    console.error("[get-document-url] Rate limit check exception (non-blocking):", rlErr);
                }

            } catch (authErr) {
                console.error("[get-document-url] High-level Authorization Exception:", authErr);
                return buildErrorResponse("INTERNAL_SERVER_ERROR", "Error validating permissions. Please check logs.", 500, req);
            }
        }

        if (!authorized) {
            return buildErrorResponse("FORBIDDEN", "Access denied", 403, req);
        }

        // 4. Fetch the raw document record (Ensure the specific side exists)
        const sideColumn = side === "front" ? "front_image_url" : "back_image_url";
        const selectCols = side === "front"
            ? "document_type, document_number_masked, front_image_url"
            : "document_type, document_number_masked, back_image_url";

        console.log(`[get-document-url] Querying guest_id_documents for Guest: ${guest_id}, Side: ${side}`);

        const { data: docRecords, error: docError } = await supabaseAdmin
            .from("guest_id_documents")
            .select(selectCols)
            .eq("guest_id", guest_id)
            .eq("is_active", true)
            .not(sideColumn, "is", null) // Optimize: only fetch if the side actually exists
            .order("created_at", { ascending: false })
            .limit(1);

        if (docError) {
            console.error(`[get-document-url] DB Query Error for side ${side}:`, docError);
            return buildErrorResponse("DATABASE_ERROR", "Failed to query document library", 500, req);
        }

        if (!docRecords || docRecords.length === 0) {
            console.log(`[get-document-url] No document found for Guest: ${guest_id}, Side: ${side}`);
            // Return 200 instead of 404 to avoid "redness" in browser console for expected missing optional sides
            return new Response(
                JSON.stringify({ error: { code: "NOT_FOUND", message: "No document found" } }),
                { status: 200, headers: { ...allowCors(req), "Content-Type": "application/json" } }
            );
        }

        const doc = docRecords[0];
        const rawPath = side === "front" ? doc.front_image_url : doc.back_image_url;

        if (!rawPath) {
            console.warn(`[get-document-url] Document record exists but ${side} path is missing:`, doc);
            return new Response(
                JSON.stringify({ error: { code: "NOT_FOUND", message: `No ${side} image path in record` } }),
                { status: 200, headers: { ...allowCors(req), "Content-Type": "application/json" } }
            );
        }

        // 5. Anti-Scraping / Hourly Rate Limit per Document
        try {
            const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
            const { count: docViews, error: vError } = await supabaseAdmin
                .from("identity_document_views")
                .select("id", { count: 'exact', head: true })
                .eq("guest_id", guest_id)
                .gte("viewed_at", oneHourAgo);

            if (vError) {
                console.warn("[get-document-url] Hourly rate check query failed (non-blocking):", vError);
            } else if (docViews !== null && docViews >= 30) {
                return buildErrorResponse("RATE_LIMITED", "Maximum hourly secure view limit reached for this document.", 429, req);
            }
        } catch (vExc) {
            console.error("[get-document-url] Hourly rate check exception (non-blocking):", vExc);
        }

        // 6. Assets Integrity & SECURE SIGNED URL
        // Validate MIME type based on extension before generating the signature
        const extIndex = rawPath.lastIndexOf(".");
        const ext = extIndex !== -1 ? rawPath.substring(extIndex + 1).toLowerCase() : "";
        const contentType = MIME_MAP[ext] || "application/octet-stream";

        if (!ALLOWED_TYPES.includes(contentType)) {
            return buildErrorResponse("INVALID_FILE_TYPE", "Unsupported document type", 400, req);
        }

        // Generate a short-lived URL for direct CDN delivery
        // This eliminates the double-hop latency of streaming files through Edge Functions.
        try {
            const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
                .from("identity_proofs")
                .createSignedUrl(rawPath, 60, {
                    download: false
                }) // 60-second micro-cache

            if (signedUrlError || !signedUrlData) {
                console.error("Signed URL Generation Error:", signedUrlError);
                return buildErrorResponse("INTERNAL_SERVER_ERROR", "Failed to generate secure document URL", 500, req);
            }

            // 7. Log the view in the audit table BEFORE returning
            // Fired as a non-blocking background task to ensure doc-view remains resilient to logging failures
            const accessMethod = callerId ? "STAFF" : "PRECHECKIN_TOKEN";
            const auditLog = async () => {
                try {
                    const { error: auditError } = await supabaseAdmin.from("identity_document_views").insert({
                        guest_id: guest_id,
                        staff_user_id: callerId, // Will be null for PRECHECKIN_TOKEN
                        hotel_id: logHotelId,
                        document_side: side,
                        document_type: doc.document_type,
                        booking_id: logBookingId,
                        ip_address: ipAddress,
                        access_method: accessMethod
                    });
                    if (auditError) console.error("[get-document-url] Audit log failed:", auditError);
                } catch (err) {
                    console.error("[get-document-url] Audit log exception:", err);
                }
            };
            auditLog();

            // 8. Return high-performance JSON response
            return new Response(
                JSON.stringify({
                    url: signedUrlData.signedUrl,
                    document_type: doc.document_type,
                    document_number: doc.document_number_masked,
                    side: side
                }),
                {
                    status: 200,
                    headers: {
                        ...allowCors(req),
                        "Content-Type": "application/json",
                        "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
                        "Pragma": "no-cache",
                        "Expires": "0"
                    }
                }
            );
        } finally {
            // No-op for now (timeout was for streaming)
        }

    } catch (err: any) {
        console.error("Internal Edge Function Error:", err);
        return buildErrorResponse("INTERNAL_SERVER_ERROR", "Internal Server Error", 500, req);
    }
});
