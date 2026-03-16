import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { allowCors } from "../_shared/cors.ts";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB (Align with frontend PDF support)

// Initialize Admin Client outside serve() to leverage Edge Runtime instance reuse
const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req: Request) => {
    // 1. Handle CORS
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: allowCors(req) });
    }

    try {
        // 2. Lightweight Guard: Block random probes
        // We check Origin instead of custom headers because supabase-js 
        // doesn't always reliably pass custom headers in all environments.
        const origin = req.headers.get("origin") || "";
        const isAllowedOrigin = origin.includes("vaiyu.co.in") || origin.includes("localhost") || origin.includes("127.0.0.1");
        
        if (!isAllowedOrigin) {
            return new Response(JSON.stringify({ error: "Forbidden: Invalid origin" }), {
                status: 403,
                headers: { ...allowCors(req), "Content-Type": "application/json" }
            });
        }

        // 3. Proactive Payload Size Guard
        const contentLengthHeader = req.headers.get("content-length");
        const contentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;
        
        if (!Number.isNaN(contentLength) && contentLength > MAX_SIZE * 1.2) {
            return new Response(JSON.stringify({ error: "Payload too large" }), { 
                status: 413,
                headers: { ...allowCors(req), "Content-Type": "application/json" }
            });
        }

        const formData = await req.formData();
        const file = formData.get("file") as File;
        const path = formData.get("path") as string;
        
        if (!file || !path || !file.name) {
            return new Response(JSON.stringify({ error: "Missing file, path, or file name" }), {
                status: 400,
                headers: { ...allowCors(req), "Content-Type": "application/json" }
            });
        }

        // 4. Validate File is not empty
        if (file.size === 0) {
            return new Response(JSON.stringify({ error: "File is empty" }), {
                status: 400,
                headers: { ...allowCors(req), "Content-Type": "application/json" }
            });
        }

        // 5. Path Validation (Prevent Path Injection)
        // Format: {uuid}/(front|back)_{timestamp}_{suffix}.{ext}
        const pathRegex = /^[a-f0-9-]{36}\/(front|back)_\d+_[a-f0-9]+\.(jpg|jpeg|png|webp|pdf)$/i;
        if (!pathRegex.test(path)) {
            return new Response(JSON.stringify({ error: "Invalid storage path format" }), {
                status: 400,
                headers: { ...allowCors(req), "Content-Type": "application/json" }
            });
        }

        // 4. Validate MIME type matches extension in path
        const ext = path.split(".").pop()?.toLowerCase();
        if (!ext) {
            return new Response(
                JSON.stringify({ error: "Invalid file extension" }),
                { status: 400, headers: { ...allowCors(req), "Content-Type": "application/json" } }
            );
        }

        if (
            (ext === "pdf" && file.type !== "application/pdf") ||
            (ext !== "pdf" && !file.type.startsWith("image/"))
        ) {
            return new Response(
                JSON.stringify({ error: "File extension does not match MIME type" }),
                { status: 400, headers: { ...allowCors(req), "Content-Type": "application/json" } }
            );
        }

        // 5. Validate File Type
        if (!ALLOWED_MIME.includes(file.type)) {
            return new Response(JSON.stringify({ error: `Unsupported file type: ${file.type}` }), {
                status: 400,
                headers: { ...allowCors(req), "Content-Type": "application/json" }
            });
        }

        // 6. Validate File Size
        if (file.size > MAX_SIZE) {
            return new Response(JSON.stringify({ error: "File size exceeds 10MB limit" }), {
                status: 400,
                headers: { ...allowCors(req), "Content-Type": "application/json" }
            });
        }

        // 7. Perform Upload
        const { data, error } = await supabaseAdmin.storage
            .from("identity_proofs")
            .upload(path, file, { 
                upsert: true,
                contentType: file.type 
            });

        if (error) {
            console.error("[upload-guest-id] Storage Error:", { path, error });
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { ...allowCors(req), "Content-Type": "application/json" }
            });
        }

        // ✨ PRODUCTION FIX: Update the database record to point to the latest uploaded file
        // This ensures that "Replace" actions are reflected in the UI immediately
        try {
            const [storageKey, filename] = path.split("/");
            const side = filename.startsWith("front_") ? "front" : "back";
            const column = side === "front" ? "front_image_url" : "back_image_url";

            const { error: dbError } = await supabaseAdmin
                .from("guest_id_documents")
                .update({
                    [column]: path,
                    updated_at: new Date().toISOString()
                })
                .eq("storage_key", storageKey)
                .eq("is_active", true)
                .limit(1);

            if (dbError) {
                console.error("[upload-guest-id] DB update failed:", dbError);
                // We don't return 500 here because the file IS successfully uploaded to storage.
                // The DB link failing is a secondary issue that usually wouldn't happen if storage worked.
            }
        } catch (dbErr) {
            console.error("[upload-guest-id] DB update internal error:", dbErr);
        }

        return new Response(JSON.stringify({ path: data.path }), {
            status: 200,
            headers: { ...allowCors(req), "Content-Type": "application/json" }
        });

    } catch (err: any) {
        console.error("[upload-guest-id] Internal Error:", err);
        return new Response(JSON.stringify({ error: "Internal Server Error" }), {
            status: 500,
            headers: { ...allowCors(req), "Content-Type": "application/json" }
        });
    }
});
