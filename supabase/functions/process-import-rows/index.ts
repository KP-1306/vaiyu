import { withObs as __withObs } from "../_shared/http-telemetry.ts";
const __serveObs = (h: (req: Request) => Response | Promise<Response>) => Deno.serve(__withObs("process-import-rows", h));
import { createClient } from "npm:@supabase/supabase-js";
import { secretKey } from "../_shared/keys.ts";

const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    secretKey()!
);

const MAX_RUNTIME_MS = 50_000; // keep below edge timeout (60s)
const LOOP_DELAY_MS = 200;     // small breathing gap to prevent DB pressure spikes
const BATCH_SIZE = 20;

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

__serveObs(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    const start = Date.now();
    let totalProcessed = 0;

    try {
        while (Date.now() - start < MAX_RUNTIME_MS) {
            // 1. Claim booking groups atomically
            const { data: groups, error: claimErr } = await supabase.rpc(
                "claim_pending_booking_groups",
                { p_limit: BATCH_SIZE }
            );

            if (claimErr) {
                console.error("Claim error:", claimErr);
                return new Response(
                    JSON.stringify({
                        success: false,
                        error: `DB Error: ${(claimErr as any).message || claimErr}`,
                        processed: totalProcessed,
                    }),
                    {
                        headers: { ...corsHeaders, "Content-Type": "application/json" },
                        status: 200,
                    }
                );
            }

            // Queue empty → exit cleanly
            if (!groups || groups.length === 0) {
                console.log("Queue empty, exiting after", totalProcessed, "groups");
                break;
            }

            // 2. Process each claimed group
            for (const group of groups) {
                try {
                    const { data: res, error: rpcErr } = await supabase.rpc(
                        "process_booking_group",
                        { p_booking_reference: group.booking_reference }
                    );

                    if (rpcErr) throw rpcErr;
                    if (res && !res.success) throw new Error(res.error);
                } catch (err: any) {
                    console.error("Process error:", group.booking_reference, err);

                    await supabase
                        .from("import_rows")
                        .update({ status: "error", error_message: err.message })
                        .eq("booking_reference", group.booking_reference);
                } finally {
                    totalProcessed++;
                }
            }

            // 3. Small delay to prevent DB pressure spikes
            await new Promise((r) => setTimeout(r, LOOP_DELAY_MS));
        }

        return new Response(
            JSON.stringify({ success: true, processed: totalProcessed }),
            {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 200,
            }
        );
    } catch (error: any) {
        console.error("Worker global error:", error);
        return new Response(
            JSON.stringify({
                success: false,
                error: error.message,
                processed: totalProcessed,
            }),
            {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 200,
            }
        );
    }
});
