
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabase = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
        );

        // 1. Fetch Pending Rows (RPC with SKIP LOCKED)
        const { data: rows, error: fetchErr } = await supabase.rpc("fetch_pending_rows", { p_limit: 100 });

        if (fetchErr) throw fetchErr;
        if (!rows || rows.length === 0) {
            return new Response(JSON.stringify({ message: "No pending rows" }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 200,
            });
        }

        const results = [];

        // 2. Process Rows
        for (const row of rows) {
            try {
                // Update to validating (optional, as we already locked/fetched, but good for visibility if lock isn't held long enough)
                // Actually, SKIP LOCKED holds the lock only during the transaction? 
                // In HTTP text, we might treat it as "fetched". 
                // Best practice: Update status to 'processing' or 'validating' immediately if the RPC didn't do it.
                // But strict SKIP LOCKED usually implies we do the work in the transaction or we update status immediately.
                // Let's assume we update status to 'validating' now.
                await supabase.from("import_rows").update({ status: "validating" }).eq("id", row.id);

                const data = row.row_data || {};

                // --- Validation ---
                if (!data.booking_reference || !data.guest_name) {
                    throw new Error("Missing required fields (booking_reference, guest_name)");
                }

                // --- Room Type Lookup ---
                let roomTypeId = null;
                if (data.room_type) {
                    const { data: rt } = await supabase
                        .from("room_types")
                        .select("id")
                        .eq("hotel_id", row.hotel_id)
                        .ilike("name", data.room_type) // Case insensitive
                        .single();
                    if (rt) roomTypeId = rt.id;
                } else if (data.room_type_id) {
                    roomTypeId = data.room_type_id;
                }

                // --- Room Lookup ---
                let roomId = null;
                if (data.room_number) {
                    const { data: rm } = await supabase
                        .from("rooms")
                        .select("id")
                        .eq("hotel_id", row.hotel_id)
                        .ilike("number", data.room_number)
                        .single();
                    if (rm) roomId = rm.id;
                } else if (data.room_id) {
                    roomId = data.room_id;
                }

                // --- Upsert Booking ---
                const { data: booking, error: bookingErr } = await supabase
                    .from("bookings")
                    .upsert({
                        hotel_id: row.hotel_id,
                        code: data.booking_reference, // Mapping to strict schema
                        guest_name: data.guest_name,
                        phone: data.phone,
                        email: data.email,
                        scheduled_checkin_at: data.checkin_date,
                        scheduled_checkout_at: data.checkout_date,
                        room_type_id: roomTypeId,
                        room_id: roomId,
                        adults: parseInt(data.adults || "1"),
                        children: parseInt(data.children || "0"),
                        special_requests: data.special_requests,
                        status: 'CONFIRMED',
                        source: 'manual'
                    }, { onConflict: "code" }) // Assuming 'code' is the unique constraint or hotel_id+booking_ref
                    .select()
                    .single();

                if (bookingErr) throw new Error(bookingErr.message);

                // --- Token Generation ---
                const { data: tokenData, error: tokenErr } = await supabase.rpc("create_precheckin_token", {
                    p_booking_id: booking.id
                });

                if (tokenErr) console.error("Token gen error", tokenErr); // Non-fatal?

                // --- Notification ---
                // Only if we have phone/email
                if (data.phone || data.email) {
                    await supabase.from("notification_queue").insert({
                        booking_id: booking.id,
                        channel: data.phone ? "whatsapp" : "email",
                        template_code: "precheckin_link",
                        payload: {
                            token: tokenData?.token,
                            guest_name: data.guest_name,
                            link: `https://vaiyu.co.in/precheckin/${tokenData?.token}`
                        },
                        status: "pending"
                    });
                }

                // --- Success ---
                await supabase.from("import_rows").update({
                    status: "notified",
                    processed_at: new Date().toISOString()
                }).eq("id", row.id);

                results.push({ id: row.id, status: "success" });

            } catch (err: any) {
                await supabase.from("import_rows").update({
                    status: "error",
                    error_message: err.message,
                    processed_at: new Date().toISOString()
                }).eq("id", row.id);
                results.push({ id: row.id, status: "error", error: err.message });
            }
        }

        return new Response(JSON.stringify({ processed: results.length, details: results }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
        });
    }
});
