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

serve(async (req: Request) => {
    // 1. Handle CORS
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: allowCors(req) });
    }

    try {
        const { guest_id, side = "front", hotel_id, token } = await req.json();
        const headers = { ...allowCors(req), "Content-Type": "application/json" };

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
            const { data: validTokens, error: tokenError } = await supabaseAdmin
                .from("precheckin_tokens")
                .select("booking_id, bookings!inner(guest_id, hotel_id)")
                .eq("token", token)
                .gt("expires_at", new Date().toISOString());

            if (tokenError || !validTokens || validTokens.length === 0) {
                console.error("Token invalid or expired:", token);
                return buildErrorResponse("UNAUTHORIZED", "Invalid or expired token", 401, req);
            }

            // Ensure token belongs to the requested guest_id
            const tokenRec = validTokens.find((t: any) => t.bookings?.guest_id === guest_id);
            if (!tokenRec) {
                return buildErrorResponse("FORBIDDEN", "Unauthorized for this guest", 403, req);
            }

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

                let query = supabaseAdmin
                    .from("hotel_members")
                    .select("role, hotel_id")
                    .eq("user_id", callerId)
                    .eq("is_active", true)
                    .in("role", ["OWNER", "MANAGER", "STAFF"]);

                if (hotel_id) {
                    query = query.eq("hotel_id", hotel_id);
                }

                const { data: roles, error: roleError } = await query;

                if (roleError || !roles || roles.length === 0) {
                    return buildErrorResponse("FORBIDDEN", "Insufficient permissions", 403, req);
                }

                // Ensure the guest actually belongs to a hotel this staff member has access to
                const allowedHotelIds = roles.map((r: { hotel_id: string }) => r.hotel_id);

                // Check bookings
                const { data: guestBookings, error: bookingError } = await supabaseAdmin
                    .from("bookings")
                    .select("id, hotel_id")
                    .eq("guest_id", guest_id)
                    .in("hotel_id", allowedHotelIds)
                    .limit(1);

                let hasAccess = guestBookings && guestBookings.length > 0;
                if (hasAccess) {
                    logHotelId = guestBookings![0].hotel_id;
                    logBookingId = guestBookings![0].id;
                } else {
                    // Try stays
                    const { data: guestStays, error: stayError } = await supabaseAdmin
                        .from("stays")
                        .select("booking_id, hotel_id")
                        .eq("guest_id", guest_id)
                        .in("hotel_id", allowedHotelIds)
                        .limit(1);

                    hasAccess = guestStays && guestStays.length > 0;
                    if (hasAccess) {
                        logHotelId = guestStays![0].hotel_id;
                        logBookingId = guestStays![0].booking_id;
                    }
                }

                if (!hasAccess) {
                    return buildErrorResponse("FORBIDDEN", "Unauthorized for this guest", 403, req);
                }

                authorized = true;

                // Rate Limiting Check (10 views per minute per staff)
                const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
                const { count, error: countError } = await supabaseAdmin
                    .from("identity_document_views")
                    .select("*", { count: 'exact', head: true })
                    .eq("staff_user_id", callerId)
                    .gte("viewed_at", oneMinuteAgo);

                if (countError) {
                    console.error("Rate limit check failed:", countError);
                } else if (count !== null && count >= 10) {
                    return buildErrorResponse("RATE_LIMITED", "Too many requests. Please wait.", 429, req);
                }

            } catch (authErr) {
                console.error("Staff auth check error:", authErr);
                return buildErrorResponse("INTERNAL_SERVER_ERROR", "Error validating permissions", 500, req);
            }
        }

        if (!authorized) {
            return buildErrorResponse("FORBIDDEN", "Access denied", 403, req);
        }

        // 4. Fetch the raw document path from the DB
        const { data: docRecords, error: docError } = await supabaseAdmin
            .from("guest_id_documents")
            .select("document_type, document_number, front_image_url, back_image_url")
            .eq("guest_id", guest_id)
            .eq("is_active", true)
            .order("created_at", { ascending: false })
            .limit(1);

        if (docError || !docRecords || docRecords.length === 0) {
            return buildErrorResponse("NOT_FOUND", "No document found", 404, req);
        }

        const doc = docRecords[0];

        // 5. Anti-Scraping / Hourly Rate Limit per Document
        const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
        const { count: docViews, error: countError2 } = await supabaseAdmin
            .from("identity_document_views")
            .select("*", { count: 'exact', head: true })
            .eq("guest_id", guest_id)
            .gte("viewed_at", oneHourAgo);

        if (docViews !== null && docViews >= 30) {
            return buildErrorResponse("RATE_LIMITED", "Maximum hourly secure view limit reached for this document.", 429, req);
        }

        // 6. Log the view in the audit table (only if staff)
        if (callerId) {
            await supabaseAdmin.from("identity_document_views").insert({
                guest_id: guest_id,
                staff_user_id: callerId,
                hotel_id: logHotelId,
                document_side: side,
                document_type: doc.document_type,
                booking_id: logBookingId,
                ip_address: ipAddress
            });
        }

        const rawPath = side === "front" ? doc.front_image_url : doc.back_image_url;

        if (!rawPath) {
            return buildErrorResponse("NOT_FOUND", `No ${side} image available`, 404, req);
        }

        // 7. Generate Signed URL (Short-lived: 120 seconds)
        const { data: signedData, error: signError } = await supabaseAdmin.storage
            .from("identity_proofs")
            .createSignedUrl(rawPath, 120);

        if (signError || !signedData?.signedUrl) {
            console.error("Failed to sign URL:", signError);
            return buildErrorResponse("INTERNAL_SERVER_ERROR", "Failed to generate temporary document link", 500, req);
        }

        // 8. Return secure signed URL (include document_number for pre-fill)
        return new Response(
            JSON.stringify({
                signed_url: signedData.signedUrl,
                document_type: doc.document_type,
                document_number: doc.document_number ?? null
            }),
            { status: 200, headers }
        );

    } catch (err: any) {
        console.error("Internal Edge Function Error:", err);
        return buildErrorResponse("INTERNAL_SERVER_ERROR", "Internal Server Error", 500, req);
    }
});
