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

        if (!guest_id) {
            return buildErrorResponse("BAD_REQUEST", "Missing guest_id", 400, req);
        }

        if (side !== "front" && side !== "back") {
            return buildErrorResponse("BAD_REQUEST", "Invalid side", 400, req);
        }

        // 2. Setup Supabase Clients
        // @ts-ignore
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        // @ts-ignore
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        // @ts-ignore
        const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

        // Admin client: skips RLS for fetching raw path, logging audit, and signing URL
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

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

                // Authenticated Staff: Fetch all roles for the user (don't trust client-side hotel_id)
                const { data: roles, error: roleError } = await supabaseAdmin
                    .from("hotel_members")
                    .select("role, hotel_id")
                    .eq("user_id", callerId)
                    .eq("is_active", true)
                    .in("role", ["OWNER", "MANAGER", "STAFF"]);

                if (roleError || !roles || roles.length === 0) {
                    return buildErrorResponse("FORBIDDEN", "Insufficient permissions", 403, req);
                }

                const allowedHotelIds = roles.map((r: { hotel_id: string }) => r.hotel_id);

                // Check access via active stays (Priority: Privacy Protection - Active or Recent Stays)
                const { data: guestStays } = await supabaseAdmin
                    .from("stays")
                    .select("booking_id, hotel_id")
                    .eq("guest_id", guest_id)
                    .in("hotel_id", allowedHotelIds)
                    .in("status", ["arriving", "inhouse"])
                    .limit(1);

                let hasAccess = guestStays && guestStays.length > 0;
                if (hasAccess) {
                    logHotelId = guestStays![0].hotel_id;
                    logBookingId = guestStays![0].booking_id;
                } else {
                    // Try active bookings (Privacy Protection: Only Confirmed/Checked-in)
                    const { data: guestBookings } = await supabaseAdmin
                        .from("bookings")
                        .select("id, hotel_id")
                        .eq("guest_id", guest_id)
                        .in("hotel_id", allowedHotelIds)
                        .in("status", ["CONFIRMED", "CHECKED_IN", "PARTIALLY_CHECKED_IN"])
                        .limit(1);

                    hasAccess = guestBookings && guestBookings.length > 0;
                    if (hasAccess) {
                        logHotelId = guestBookings![0].hotel_id;
                        logBookingId = guestBookings![0].id;
                    }
                }

                if (!hasAccess) {
                    return buildErrorResponse("FORBIDDEN", "Unauthorized for this guest or stay no longer active", 403, req);
                }

                authorized = true;

                // Rate Limiting Check (10 views per minute per staff for this SPECIFIC guest)
                // This prevents rapid refreshes or script-based document scraping.
                const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
                const { count } = await supabaseAdmin
                    .from("identity_document_views")
                    .select("id", { count: 'planned', head: true })
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
            .select("id", { count: 'planned', head: true })
            .eq("guest_id", guest_id)
            .gte("viewed_at", oneHourAgo);

        if (docViews !== null && docViews >= 30) {
            return buildErrorResponse("RATE_LIMITED", "Maximum hourly secure view limit reached for this document.", 429, req);
        }

        // 6. SECURE PROXY: Download from storage with timeout guard (Binary Streaming)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        try {
            const { data: fileData, error: downloadError } = await supabaseAdmin.storage
                .from("identity_proofs")
                .download(rawPath, { signal: controller.signal });

            if (downloadError || !fileData) {
                console.error("Storage Download Error:", downloadError);
                return buildErrorResponse("INTERNAL_SERVER_ERROR", "Failed to retrieve secure document", 500, req);
            }

            // Safety: Check file size (no documents should exceed 5MB)
            if (fileData.size > 5 * 1024 * 1024) {
                return buildErrorResponse("FILE_TOO_LARGE", "Document exceeds maximum allowed size (5MB)", 413, req);
            }

            // 7. Validate MIME Type BEFORE Auditing
            const ext = rawPath.split('.').pop()?.toLowerCase() || "";
            const contentType = MIME_MAP[ext] || "application/octet-stream";

            if (!ALLOWED_TYPES.includes(contentType)) {
                return buildErrorResponse("INVALID_FILE_TYPE", "Unsupported document type", 400, req);
            }

            // 8. Log the view in the audit table ONLY after successful file retrieval and validation
            // Record whether it was a staff member or a guest with a pre-checkin token
            const accessMethod = callerId ? "STAFF" : "PRECHECKIN_TOKEN";
            await supabaseAdmin.from("identity_document_views").insert({
                guest_id: guest_id,
                staff_user_id: callerId, // Will be null for PRECHECKIN_TOKEN
                hotel_id: logHotelId,
                document_side: side,
                document_type: doc.document_type,
                booking_id: logBookingId,
                ip_address: ipAddress,
                access_method: accessMethod
            });

            // 9. Return high-performance binary response
            // Metadata is passed via headers to avoid Base64 overhead while preserving form pre-fill
            return new Response(fileData, {
                status: 200,
                headers: {
                    ...allowCors(req),
                    "Content-Type": contentType,
                    "Content-Disposition": "inline",
                    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0",
                    "X-Content-Type-Options": "nosniff",
                    "Referrer-Policy": "no-referrer",
                    "Content-Security-Policy": "default-src 'none'; img-src 'self' data:;",
                    "X-Frame-Options": "DENY",
                    "X-Document-Type": doc.document_type || "",
                    "X-Document-Number": doc.document_number || "",
                    "Access-Control-Expose-Headers": "X-Document-Type, X-Document-Number"
                }
            });
        } finally {
            clearTimeout(timeout);
        }

    } catch (err: any) {
        console.error("Internal Edge Function Error:", err);
        return buildErrorResponse("INTERNAL_SERVER_ERROR", "Internal Server Error", 500, req);
    }
});
