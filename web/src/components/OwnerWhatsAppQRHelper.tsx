// web/src/components/OwnerWhatsAppQRHelper.tsx
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import Spinner from "./Spinner";

type HotelInfo = {
  id: string;
  name: string;
  slug: string;
  wa_display_number: string | null;
};

type FetchResult =
  | { state: "no-user" }
  | { state: "no-hotel" }
  | { state: "ok"; hotel: HotelInfo; waNumber: string | null };

function normalizeWhatsAppNumber(input: string | null): string | null {
  if (!input) return null;
  // Remove all non-digits
  const digits = input.replace(/\D/g, "");
  if (!digits) return null;
  // We assume owner will store it with country code already (e.g. "919876543210")
  return digits;
}

async function fetchOwnerWhatsAppContext(): Promise<FetchResult> {
  // 1) Current user
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes?.user) {
    return { state: "no-user" };
  }
  const userId = userRes.user.id;

  // 2) Find one hotel membership (owner/staff) – v1: just pick the first
  const { data: member, error: memberErr } = await supabase
    .from("hotel_members")
    .select("hotel_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (memberErr || !member) {
    return { state: "no-hotel" };
  }

  // 3) Load hotel info
  const { data: hotel, error: hotelErr } = await supabase
    .from("hotels")
    .select("id, name, slug, wa_display_number")
    .eq("id", member.hotel_id)
    .maybeSingle();

  if (hotelErr || !hotel) {
    return { state: "no-hotel" };
  }

  const waNumber = normalizeWhatsAppNumber(hotel.wa_display_number);

  return {
    state: "ok",
    hotel: hotel as HotelInfo,
    waNumber,
  };
}

export default function OwnerWhatsAppQRHelper() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["owner_whatsapp_qr_helper"],
    queryFn: fetchOwnerWhatsAppContext,
  });

  if (isLoading) {
    return (
      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">
          WhatsApp menu QR
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          Preparing your WhatsApp menu link…
        </p>
        <div className="mt-3">
          <Spinner label="Loading…" />
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mt-8 rounded-xl border border-red-100 bg-red-50 p-4">
        <h2 className="text-base font-semibold text-red-800">
          WhatsApp menu QR
        </h2>
        <p className="mt-2 text-sm text-red-700">
          Failed to load WhatsApp settings. Please try again later or contact
          VAiyu support.
        </p>
      </section>
    );
  }

  if (!data || data.state === "no-user") {
    return (
      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">
          WhatsApp menu QR
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          Please sign in to view your hotel&apos;s WhatsApp menu link.
        </p>
      </section>
    );
  }

  if (data.state === "no-hotel") {
    return (
      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">
          WhatsApp menu QR
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          We couldn&apos;t find a hotel linked to your account yet. Once your
          property is set up in VAiyu, this section will show the WhatsApp menu
          link and QR details.
        </p>
      </section>
    );
  }

  // Happy path
  const { hotel, waNumber } = data;

  const upperSlug = hotel.slug.toUpperCase();
  const genericMessage = `MENU ${upperSlug}`;
  const roomTemplateMessage = `MENU ${upperSlug} ROOM 101`;

  const clickToChatUrl = waNumber
    ? `https://wa.me/${waNumber}?text=${encodeURIComponent(genericMessage)}`
    : null;

  return (
    <section className="mt-8 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            WhatsApp menu QR
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Use this to create lobby / room QRs that open WhatsApp with your
            hotel&apos;s menu command pre-filled.
          </p>
        </div>
        <div className="text-right text-xs text-gray-500">
          <div className="font-medium text-gray-700">{hotel.name}</div>
          <div className="font-mono text-[11px] text-gray-500">
            slug: {upperSlug}
          </div>
        </div>
      </div>

      {!waNumber && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          WhatsApp number is not configured yet. Please ask VAiyu support or
          your implementation partner to set{" "}
          <span className="font-mono">wa_display_number</span> for this hotel
          (e.g. <span className="font-mono">919876543210</span>).
        </p>
      )}

      {waNumber && (
        <div className="mt-4 space-y-4 text-sm">
          <div>
            <div className="text-xs font-medium text-gray-600">
              WhatsApp number in use
            </div>
            <div className="mt-1 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 font-mono text-xs text-gray-800">
              {waNumber}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-gray-600">
              Click-to-Chat URL (for QR generator)
            </div>
            <input
              readOnly
              className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-mono text-gray-800"
              value={clickToChatUrl ?? ""}
              onFocus={(e) => e.currentTarget.select()}
            />
            <p className="mt-1 text-xs text-gray-500">
              Paste this URL into any QR generator to create a common lobby QR.
              It opens WhatsApp with <code>MENU {upperSlug}</code> pre-filled.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs font-medium text-gray-600">
                Lobby message (generic)
              </div>
              <input
                readOnly
                className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-mono text-gray-800"
                value={genericMessage}
                onFocus={(e) => e.currentTarget.select()}
              />
              <p className="mt-1 text-xs text-gray-500">
                For reception / common areas. Guests can scan the QR and see
                the full hotel menu.
              </p>
            </div>

            <div>
              <div className="text-xs font-medium text-gray-600">
                Room QR template message
              </div>
              <input
                readOnly
                className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-mono text-gray-800"
                value={roomTemplateMessage}
                onFocus={(e) => e.currentTarget.select()}
              />
              <p className="mt-1 text-xs text-gray-500">
                For per-room QRs: replace <code>101</code> with the actual room
                number before generating each QR (e.g. ROOM 312).
              </p>
            </div>
          </div>

          <p className="mt-2 text-xs text-gray-500">
            In v1, the guest will see a view-only menu in WhatsApp. Ordering
            flows can be added later.
          </p>
        </div>
      )}
    </section>
  );
}
