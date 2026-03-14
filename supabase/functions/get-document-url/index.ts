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

                // Authenticated Staff: Fetch access in ONE query (Consolidated Authorization)
                // This joins hotel_members and bookings at the DB level, checking permissions in one step.
                const { data: accessCheck, error: accessError } = await supabaseAdmin
                    .from("hotel_members")
                    .select(`
                        hotel_id,
                        bookings!inner(id, guest_id)
                    `)
                    .eq("user_id", callerId)
                    .eq("is_active", true)
                    .in("role", ["OWNER", "MANAGER", "STAFF"])
                    .eq("bookings.guest_id", guest_id)
                    .in("bookings.status", ["CONFIRMED", "CHECKED_IN", "PARTIALLY_CHECKED_IN"])
                    .limit(1);

                if (accessError || !accessCheck || accessCheck.length === 0) {
                    console.error("Access check failed or unauthorized:", accessError);
                    return buildErrorResponse("FORBIDDEN", "Unauthorized for this guest or no active booking found", 403, req);
                }

                const accessRec = accessCheck[0];
                logHotelId = accessRec.hotel_id;
                // PostgREST returns an array for one-to-many joins
                logBookingId = Array.isArray(accessRec.bookings) ? accessRec.bookings[0]?.id : (accessRec.bookings as any)?.id;
                
                authorized = true;

                // Rate Limiting Check (10 views per minute per staff for this SPECIFIC guest)
                // This prevents rapid refreshes or script-based document scraping.
                const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
                const { count } = await supabaseAdmin
                    .from("identity_document_views")
                    .select("id", { count: 'exact', head: true })
                    .eq("staff_user_id", callerId)
                    .eq("guest_id", guest_id)
                    .gte("viewed_at", oneMinuteAgo);

                if (count !== null && count >= 10) {
                    return buildErrorResponse("RATE_LIMITED", "Too many requests for this document. Please wait a minute.", 429, req);
                }

            } catch (authErr) {
                console.error("Staff auth check error:", authErr);
                return buildErrorResponse("INTERNAL_SERVER_ERROR", "Error validating permissions", 500, req);
            }
        }

        if (!authorized) {
            return buildErrorResponse("FORBIDDEN", "Access denied", 403, req);
        }

        // 4. Fetch the raw document record (Ensure the specific side exists)
        const sideColumn = side === "front" ? "front_image_url" : "back_image_url";
        const selectCols = side === "front"
            ? "document_type, document_number, front_image_url"
            : "document_type, document_number, back_image_url";

        const { data: docRecords, error: docError } = await supabaseAdmin
            .from("guest_id_documents")
            .select(selectCols)
            .eq("guest_id", guest_id)
            .eq("is_active", true)
            .not(sideColumn, "is", null) // Optimize: only fetch if the side actually exists
            .order("created_at", { ascending: false })
            .limit(1);

        if (docError || !docRecords || docRecords.length === 0) {
            return buildErrorResponse("NOT_FOUND", "No document found", 404, req);
        }

        const doc = docRecords[0];
        const rawPath = side === "front" ? doc.front_image_url : doc.back_image_url;

        if (!rawPath) {
            return buildErrorResponse("NOT_FOUND", `No ${side} image available`, 404, req);
        }

        // 5. Anti-Scraping / Hourly Rate Limit per Document
        const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
        const { count: docViews } = await supabaseAdmin
            .from("identity_document_views")
            .select("id", { count: 'exact', head: true })
            .eq("guest_id", guest_id)
            .gte("viewed_at", oneHourAgo);

        if (docViews !== null && docViews >= 30) {
            return buildErrorResponse("RATE_LIMITED", "Maximum hourly secure view limit reached for this document.", 429, req);
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
            supabaseAdmin.from("identity_document_views").insert({
                guest_id: guest_id,
                staff_user_id: callerId, // Will be null for PRECHECKIN_TOKEN
                hotel_id: logHotelId,
                document_side: side,
                document_type: doc.document_type,
                booking_id: logBookingId,
                ip_address: ipAddress,
                access_method: accessMethod
            }).catch((err: any) => console.error("Audit log failed:", err));

            // 8. Return high-performance JSON response
            return new Response(
                JSON.stringify({
                    url: signedUrlData.signedUrl,
                    document_type: doc.document_type,
                    document_number: doc.document_number,
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
