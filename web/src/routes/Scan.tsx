// web/src/routes/Scan.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams, useNavigate } from "react-router-dom";
import SEO from "../components/SEO";
import Spinner from "../components/Spinner";
import { getHotel, isDemo } from "../lib/api";

type HotelInfo = {
  slug: string;
  name?: string;
  description?: string;
  address?: string;
  phone?: string;
  email?: string;
  theme?: { brand?: string; mode?: "light" | "dark" };
};

function useQueryParams() {
  const [searchParams] = useSearchParams();
  const hotelSlug = searchParams.get("hotel") || searchParams.get("slug") || "";
  const stayCode = searchParams.get("code") || "";
  return { hotelSlug, stayCode };
}

export default function Scan() {
  const navigate = useNavigate();
  const location = useLocation();
  const { hotelSlug, stayCode } = useQueryParams();

  const [hotel, setHotel] = useState<HotelInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(!!hotelSlug);
  const [error, setError] = useState<string | null>(null);

  // ─────────────────────────────────────────────
  // Resolve menu URL (internal route path)
  // ─────────────────────────────────────────────
  const menuPath = useMemo(() => {
    if (stayCode) {
      // Full guest journey: stay-specific menu
      return "/stay/" + encodeURIComponent(stayCode) + "/menu";
    }
    if (hotelSlug) {
      // Hotel-scoped menu (backend can later read ?hotel=slug)
      return "/menu?hotel=" + encodeURIComponent(hotelSlug);
    }
    // No context → we should NOT send the guest to /menu blindly
    return null;
  }, [hotelSlug, stayCode]);

  // Friendly label
  const hotelLabel = useMemo(() => {
    if (hotel?.name) return hotel.name;
    if (hotelSlug) return hotelSlug;
    return "this property";
  }, [hotelSlug, hotel]);

  // ─────────────────────────────────────────────
  // Load hotel details (for nicer text + branding), but fail gracefully
  // ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    if (!hotelSlug) {
      // Nothing to load if we don't know the property
      setLoading(false);
      return;
    }

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res: any = await getHotel(hotelSlug);
        if (cancelled) return;

        const info: HotelInfo = {
          slug: res?.slug ?? hotelSlug,
          name: res?.name,
          description: res?.description,
          address: res?.address,
          phone: res?.phone,
          email: res?.email,
          theme: res?.theme,
        };
        setHotel(info);
      } catch (e: any) {
        if (!cancelled) {
          console.warn("[Scan] Could not load property details", e);
          setError(
            "हम अभी प्रॉपर्टी की पूरी जानकारी नहीं ला पाए — आप फिर भी नीचे से मेनू खोल सकते हैं।"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hotelSlug]);

  // ─────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────
  function handleOpenWebMenu() {
    if (!menuPath) {
      // No hotel / stay information → avoid sending to /menu (404)
      setError(
        "We couldn’t detect which property this QR belongs to. " +
          "Please scan the VAiyu QR at your hotel (or ask the front desk) and try again."
      );
      return;
    }
    setError(null);
    navigate(menuPath);
  }

  function handleOpenWhatsApp() {
    if (!menuPath) {
      setError(
        "We can’t build a menu link because this page doesn’t include a hotel or stay code. " +
          "Please scan the VAiyu QR at the property again."
      );
      return;
    }

    // Build a shareable absolute URL for the menu
    const base =
      typeof window !== "undefined" ? window.location.origin || "" : "";
    const fullUrl = `${base}${menuPath}`;

    const textLines = [
      `नमस्ते, मुझे ${hotelLabel} का मेनू देखना है।`,
      "",
      fullUrl,
    ];
    const text = encodeURIComponent(textLines.join("\n"));

    // Generic WhatsApp share (user picks contact / hotel number)
    const waUrl = `https://wa.me/?text=${text}`;
    window.location.href = waUrl;
  }

  const themeColor =
    hotel?.theme?.brand || (isDemo() ? "#145AF2" : "#0f766e"); // default teal for non-demo

  return (
    <>
      <SEO title="Scan to open guest menu" noIndex />

      <main className="min-h-[60vh] px-4 py-6 flex items-center justify-center">
        <div className="w-full max-w-md space-y-4">
          <header className="space-y-1 text-center">
            <p className="text-xs uppercase tracking-wide text-gray-500">
              Scan to open
            </p>
            <h1 className="text-xl font-semibold">
              Welcome to{" "}
              <span style={{ color: themeColor }}>
                {hotel?.name || "your stay"}
              </span>
            </h1>
            <p className="text-sm text-gray-600">
              You just scanned a QR at the property. Choose how you want to open
              the guest menu and services.
            </p>
          </header>

          {/* Hotel badge */}
          {(hotel || hotelSlug) && (
            <section className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {hotel?.name || hotelLabel}
                  </div>
                  {hotel?.address && (
                    <div className="mt-0.5 text-xs text-gray-500">
                      {hotel.address}
                    </div>
                  )}
                  {hotel?.phone && (
                    <div className="mt-0.5 text-xs text-gray-500">
                      ☎ {hotel.phone}
                    </div>
                  )}
                </div>
                <div
                  className="rounded-full px-2 py-1 text-[11px] font-medium text-white"
                  style={{ backgroundColor: themeColor }}
                >
                  Powered by VAiyu
                </div>
              </div>
            </section>
          )}

          {/* Status / errors */}
          {loading && (
            <div className="mt-2">
              <Spinner label="Loading property…" />
            </div>
          )}

          {error && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
              {error}
            </p>
          )}

          {/* Primary actions */}
          <section className="space-y-3">
            <button
              type="button"
              onClick={handleOpenWebMenu}
              className="inline-flex w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50"
            >
              Open web menu
            </button>

            <button
              type="button"
              onClick={handleOpenWhatsApp}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-green-500 px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-green-600"
            >
              {/* Simple WA glyph */}
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-lg leading-none">
                💬
              </span>
              Open in WhatsApp
            </button>
          </section>

          {/* Explanation */}
          <section className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 space-y-1.5">
            <p className="font-medium text-gray-700">How this works:</p>
            <ol className="list-decimal pl-4 space-y-1">
              <li>
                <b>Web menu</b> opens the in-room menu and services directly in
                your browser.
              </li>
              <li>
                <b>WhatsApp</b> opens a chat with a pre-filled link to this
                property&apos;s menu. You can pin/save that chat for quick
                access.
              </li>
            </ol>
            <p className="text-[11px] text-gray-500">
              If you have a live booking, your link may include your stay code
              so that requests automatically reach the right room.
            </p>
            <p className="text-[10px] text-gray-400">
              URL: <code>{location.pathname + location.search}</code>
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
