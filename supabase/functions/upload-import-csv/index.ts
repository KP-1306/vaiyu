
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Papa from "https://esm.sh/papaparse@5.3.2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CHUNK_SIZE = 1000;

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const formData = await req.formData();
        const file = formData.get("file") as File;
        const hotelId = formData.get("hotel_id");
        const mappingsStr = formData.get("mappings");

        if (!file || !hotelId) {
            console.error("Missing file or hotel_id");
            throw new Error("Missing file or hotel_id");
        }

        let mappings: Record<string, string> = {};
        if (mappingsStr && typeof mappingsStr === "string") {
            try { mappings = JSON.parse(mappingsStr); } catch (e) { console.error("Invalid mappings JSON", e); }
        }

        const text = await file.text();
        const { data: rows } = Papa.parse(text, {
            header: true,
            skipEmptyLines: true,
            comments: "#",
            transformHeader: (header) => {
                return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
            }
        });

        if (rows.length === 0) throw new Error("Empty CSV file");

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
            console.error("Batch Creation Error", batchErr);
            throw batchErr;
        }

        // Handle potential array return or null data
        const batch = Array.isArray(batchData) ? batchData[0] : batchData;
        if (!batch || !batch.id) {
            console.error("Batch created but no ID returned", batchData);
            throw new Error("Failed to retrieve batch ID");
        }

        // 2. Insert Rows (Chunks)
        let buffer: any[] = [];

        // Normalize Keys Helper
        const normalizeRow = (row: any) => {
            const newRow: any = {};
            Object.keys(row).forEach(key => {
                // If we have a mapping for this CSV header, use the mapped field name (e.g. "Guest Name" -> "guest_name")
                // Otherwise keep original key
                const mappedKey = mappings[key] || key;
                newRow[mappedKey] = row[key];
            });
            return newRow;
        };

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            buffer.push({
                batch_id: batch.id,
                hotel_id: hotelId,
                row_number: i + 1,
                booking_reference: row['booking_reference'] || row['Booking Reference'] || `row-${i + 1}`,
                row_data: normalizeRow(row), // Apply mapping storage
                status: 'pending'
            });

            if (buffer.length >= CHUNK_SIZE) {
                const { error } = await supabase.from("import_rows").insert(buffer);
                if (error) console.error("Error inserting chunk", error);
                buffer = [];
            }
        }

        if (buffer.length > 0) {
            await supabase.from("import_rows").insert(buffer);
        }

        const resBody = { batchId: batch.id, total: rows.length };
        console.log("Success! Returning:", resBody);

        return new Response(JSON.stringify(resBody), {
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
