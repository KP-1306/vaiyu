import { createClient } from "npm:@supabase/supabase-js";
import Papa from "npm:papaparse";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHUNK_SIZE = 1000;

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const formData = await req.formData();
        const file = formData.get("file") as File;
        const hotelId = formData.get("hotel_id");
        const mappingsStr = formData.get("mappings");

        if (!file || !hotelId) {
            console.error("[upload] Missing file or hotel_id");
            return new Response(JSON.stringify({ error: "Missing file or hotel_id" }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 400,
            });
        }

        let mappings: Record<string, string> = {};
        if (mappingsStr && typeof mappingsStr === "string") {
            try { mappings = JSON.parse(mappingsStr); } catch (e) { console.error("Invalid mappings JSON", e); }
        }

        const text = await file.text();
        console.log(`[upload] Parsing CSV: ${file.name}, size: ${text.length}, hotelId: ${hotelId}`);

        const { data: rows } = Papa.parse(text, {
            header: true,
            skipEmptyLines: true,
            comments: "#",
            transformHeader: (header: string) => {
                return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
            }
        });

        if (!rows || rows.length === 0) {
            return new Response(JSON.stringify({ error: "Empty CSV file" }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 400,
            });
        }

        console.log(`[upload] Parsed ${rows.length} rows. First row keys:`, Object.keys(rows[0]));

        const supabase = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
        );

        // 1. Create Batch
        const { data: batchData, error: batchErr } = await supabase
            .from("import_batches")
            .insert({
                hotel_id: hotelId,
                file_name: file.name || "upload.csv",
                total_rows: rows.length,
                status: "processing"
            })
            .select()
            .single();

        if (batchErr) {
            console.error("[upload] Batch Creation Error:", JSON.stringify(batchErr));
            return new Response(JSON.stringify({ error: `Batch creation failed: ${batchErr.message}` }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 400,
            });
        }

        const batch = Array.isArray(batchData) ? batchData[0] : batchData;
        if (!batch || !batch.id) {
            console.error("[upload] Batch created but no ID returned", batchData);
            return new Response(JSON.stringify({ error: "Failed to retrieve batch ID" }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 400,
            });
        }

        console.log(`[upload] Batch created: ${batch.id}`);

        // 2. UPSERT Rows in Chunks (Enterprise Pattern)
        // ON CONFLICT (booking_reference, source) DO UPDATE
        // This preserves retry safety, historical consistency, and multi-worker safety
        let buffer: any[] = [];

        const normalizeRow = (row: any) => {
            const newRow: any = {};
            Object.keys(row).forEach(key => {
                const mappedKey = mappings[key] || key;
                newRow[mappedKey] = row[key];
            });
            return newRow;
        };

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const normalized = normalizeRow(row);

            // Default to 1 if not provided — NULL breaks unique index (NULL != NULL in Postgres)
            const roomSeq = normalized['room_seq'] ? parseInt(normalized['room_seq']) : 1;
            const guestSeq = normalized['guest_seq'] ? parseInt(normalized['guest_seq']) : 1;

            let primaryFlag = false;
            const flagVal = normalized['primary_guest_flag'];
            if (flagVal) {
                const lower = String(flagVal).toLowerCase().trim();
                primaryFlag = (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'y');
            }

            buffer.push({
                batch_id: batch.id,
                hotel_id: hotelId,
                row_number: i + 1,
                booking_reference: normalized['booking_reference'] || row['Booking Reference'] || `row-${i + 1}`,
                row_data: normalized,
                status: 'pending',
                source: 'csv',
                room_seq: isNaN(roomSeq) ? 1 : roomSeq,
                guest_seq: isNaN(guestSeq) ? 1 : guestSeq,
                primary_guest_flag: primaryFlag
            });

            if (buffer.length >= CHUNK_SIZE) {
                const { error } = await supabase
                    .from("import_rows")
                    .upsert(buffer, {
                        onConflict: 'booking_reference,room_seq,guest_seq,source',
                        ignoreDuplicates: false
                    });
                if (error) {
                    console.error(`[upload] Chunk upsert error at row ${i}:`, JSON.stringify(error));
                    throw new Error(`Row upsert failed at row ${i}: ${error.message}`);
                }
                buffer = [];
            }
        }

        if (buffer.length > 0) {
            const { error: finalErr } = await supabase
                .from("import_rows")
                .upsert(buffer, {
                    onConflict: 'booking_reference,room_seq,guest_seq,source',
                    ignoreDuplicates: false
                });
            if (finalErr) {
                console.error("[upload] Final chunk upsert error:", JSON.stringify(finalErr));
                throw new Error(`Final row upsert failed: ${finalErr.message}`);
            }
        }

        const resBody = { batchId: batch.id, total: rows.length };
        console.log("[upload] Success:", resBody);

        return new Response(JSON.stringify(resBody), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
        });

    } catch (error: any) {
        console.error("[upload] Fatal error:", error.message, error.stack);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
        });
    }
});
