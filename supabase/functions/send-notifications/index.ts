
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { Resend } from "npm:resend";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Env vars
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const resend = new Resend(RESEND_API_KEY);

// Helper: Send WhatsApp
async function sendWhatsAppText(phoneNumberId: string, to: string, body: string) {
    if (!WHATSAPP_TOKEN) {
        console.warn("Skipping WhatsApp: WHATSAPP_TOKEN not set");
        return;
    }

    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            messaging_product: "whatsapp",
            to: to,
            text: { body: body },
        }),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`WhatsApp API Error: ${res.status} ${text}`);
    }
}

// Helper: Send Email
async function sendEmail(from: string, to: string, subject: string, html: string) {
    if (!RESEND_API_KEY) {
        console.error("Resend API Key missing");
        throw new Error("notification_send_failed");
    }
    const { data, error } = await resend.emails.send({
        from,
        to,
        subject,
        html,
    });

    if (error) {
        console.error("Resend Error:", error);
        throw new Error("notification_send_failed");
    }
    return data;
}

// Formatters
async function formatWhatsAppMessage(template: string, payload: any, guestName: string) {
    const link = payload.link || "https://vaiyu.co.in";
    const guest = guestName || "Valued Guest";

    if (template === 'precheckin_link') {
        return `Hello ${guest}, please complete your pre-checkin here: ${link}`;
    }
    if (template === 'precheckin_reminder_1') {
        return `Hi ${guest}, your stay is coming up tomorrow! Complete pre-checkin to save time: ${link}`;
    }
    if (template === 'precheckin_reminder_2') {
        return `Good morning ${guest}! We look forward to welcoming you today. Quick pre-checkin: ${link}`;
    }
    return `Notification: ${JSON.stringify(payload)}`;
}

async function formatEmailMessage(template: string, payload: any, guestName: string, hotelName: string) {
    const link = payload.link || `https://vaiyu.co.in/precheckin/${payload.token || ''}`;
    const guest = guestName || "Valued Guest";
    const hotel = hotelName || "Hotel";

    let subject = "Update from Hotel";
    let body = "";

    const commonHeader = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Complete Your Pre-Check-in</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:30px 0;">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 6px 18px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#5b8cff,#7f53ff);color:#ffffff;padding:28px;text-align:center;">
              <h1 style="margin:0;font-size:26px;">Welcome to Your Upcoming Stay</h1>
              <p style="margin-top:8px;font-size:15px;opacity:0.9;">Let’s make your arrival smooth and effortless</p>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding:32px;text-align:center;color:#333;">
    `;

    const commonFooter = `
              <!-- CTA Button -->
              <a href="${link}" 
                 style="display:inline-block;padding:16px 36px;background:linear-gradient(135deg,#ff7a18,#ffb347);
                 color:#ffffff;text-decoration:none;font-weight:bold;border-radius:50px;
                 font-size:16px;box-shadow:0 4px 12px rgba(255,122,24,0.35);">
                 Complete Pre-Check-in
              </a>

              <p style="margin-top:28px;font-size:13px;color:#777;">
                If the button does not work, copy and paste this link:<br>
                <span style="color:#5b8cff;">${link}</span>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#fafbff;text-align:center;padding:20px;font-size:12px;color:#888;">
              We look forward to welcoming you.<br>
              <strong>${hotel}</strong>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    if (template === 'precheckin_link') {
        subject = "Complete your Pre-checkin";
        body = `
            ${commonHeader}
              <h2 style="margin-top:0;">Complete Your Pre-Check-in</h2>
              <p style="font-size:16px;line-height:1.6;margin-bottom:28px;">
                Dear <strong>${guest}</strong>,<br>
                Save time at reception by completing your pre-check-in before arrival.
                It takes less than a minute.
              </p>
            ${commonFooter}
        `;
    }
    else if (template === 'precheckin_reminder_1') {
        subject = "Your Stay Starts Tomorrow!";
        body = `
            ${commonHeader}
              <h2 style="margin-top:0;">Your Stay Starts Tomorrow!</h2>
              <p style="font-size:16px;line-height:1.6;margin-bottom:28px;">
                Dear <strong>${guest}</strong>,<br>
                We're excited to see you soon. <br>To ensure a seamless arrival, please complete your pre-check-in now. It only takes a moment.
              </p>
            ${commonFooter}
        `;
    }
    else if (template === 'precheckin_reminder_2') {
        subject = `Welcome to ${hotel}!`;
        body = `
            ${commonHeader}
              <h2 style="margin-top:0;">Your Room is Ready!</h2>
              <p style="font-size:16px;line-height:1.6;margin-bottom:28px;">
                Dear <strong>${guest}</strong>,<br>
                We are looking forward to welcoming you today.<br>
                Skip the paperwork at the front desk by completing your pre-check-in below.
              </p>
            ${commonFooter}
        `;
    }

    return { subject, html: body };
}

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 1. Fetch pending notifications
        const { data: notifications, error: fetchErr } = await supabase.rpc("fetch_pending_notifications", { p_limit: 50 });

        if (fetchErr) throw fetchErr;

        if (!notifications || notifications.length === 0) {
            return new Response(JSON.stringify({ processed: 0 }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 200,
            });
        }

        let processed = 0;
        const results = [];

        for (const notif of notifications) {
            try {
                // Update to processing
                await supabase.from("notification_queue")
                    .update({ status: "processing" })
                    .eq("id", notif.id);

                // Fetch Payload details
                const { guest_name } = notif.payload || {};

                // Get Booking & Hotel details for contact info
                const { data: booking, error: bookingErr } = await supabase
                    .from("bookings")
                    .select(`
                        phone, 
                        email, 
                        guest_name,
                        hotels ( id, name, wa_phone_number_id, email )
                    `)
                    .eq("id", notif.booking_id)
                    .single();

                if (bookingErr || !booking) throw new Error("Booking not found");

                const hotel = booking.hotels;
                // If guest name missing in payload, use booking
                const actualGuestName = guest_name || booking.guest_name;

                // Send based on channel
                if (notif.channel === "whatsapp") {
                    if (!hotel?.wa_phone_number_id) throw new Error("Hotel WhatsApp ID not configured");
                    if (!booking.phone) throw new Error("Guest phone missing");

                    const message = await formatWhatsAppMessage(notif.template_code, notif.payload, actualGuestName);
                    await sendWhatsAppText(hotel.wa_phone_number_id, booking.phone, message);
                }
                else if (notif.channel === "email") {
                    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
                    if (!booking.email) throw new Error("Guest email missing");

                    const { subject, html } = await formatEmailMessage(notif.template_code, notif.payload, actualGuestName, hotel.name || 'Hotel');

                    // Sender Logic
                    // DEV MODE: Use onboarding@resend.dev until domain is verified
                    const from = "onboarding@resend.dev";

                    /* PROD MODE (Once domain verified):
                    const from = hotel?.email
                        ? `${hotel.name || 'Hotel'} <${hotel.email}>`
                        : "Vaiyu <stays@vaiyu.co.in>";
                    */

                    await sendEmail(from, booking.email, subject, html);
                }
                else {
                    throw new Error(`Unsupported channel: ${notif.channel}`);
                }

                // Success
                await supabase.from("notification_queue")
                    .update({
                        status: "sent",
                        sent_at: new Date().toISOString()
                    })
                    .eq("id", notif.id);

                processed++;
                results.push({ id: notif.id, status: "sent" });

            } catch (err: any) {
                console.error(`Failed to process notification ${notif.id}:`, err);

                await supabase.from("notification_queue")
                    .update({
                        status: "pending",
                        error_message: err.message,
                        retry_count: (notif.retry_count || 0) + 1,
                        next_attempt_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
                    })
                    .eq("id", notif.id);

                results.push({ id: notif.id, status: "pending", error: err.message });
            }
        }

        return new Response(JSON.stringify({ processed, results }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
        });

    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
        });
    }
});
