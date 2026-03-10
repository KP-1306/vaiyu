// web/src/routes/OwnerSettings.tsx

import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import OwnerGate from "../components/OwnerGate";
import SEO from "../components/SEO";
import UsageMeter from "../components/UsageMeter";
// -------- Types --------
type Theme = { brand?: string; mode?: "light" | "dark" };



type Hotel = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  address?: string;
  amenities?: string[];
  phone?: string;
  email?: string;
  logo_url?: string;
  theme?: Theme;
  upi_id?: string;

  // Newly Added Fields from Onboarding
  default_checkin_time?: string;
  default_checkout_time?: string;
  early_checkin_allowed?: boolean;
  late_checkout_allowed?: boolean;
  timezone?: string;
  currency_code?: string;
  tax_percentage?: number | null;
  service_charge_percentage?: number | null;
  invoice_prefix?: string | null;
  invoice_counter?: number;
  legal_name?: string | null;
  gst_number?: string | null;

  // Guest Info Fields
  wifi_ssid?: string | null;
  wifi_password?: string | null;
  breakfast_start?: string | null;
  breakfast_end?: string | null;
  guest_notes?: string | null;
};



// -------- CSV helpers for amenities preview --------
function toCsv(arr?: string[]) {
  return (arr || []).join(", ");
}
function fromCsv(s: string) {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

// -------- Page --------
export default function OwnerSettings() {
  const params = useParams<{ slug?: string }>();

  // which hotel to edit (supports both ?slug= and /owner/:slug/settings)
  const [slug, setSlug] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const spSlug = new URLSearchParams(window.location.search).get("slug");
      if (spSlug) return spSlug;
    }
    return params.slug || "TENANT1";
  });

  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [amenitiesCsv, setAmenitiesCsv] = useState("");

  // ui state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    setOk(null);
    setLoading(true);

    try {
      let hRaw: any = null;
      let sRaw: any = {};

      // ---- Load directly via Supabase ----
      const { data: hotelRow, error: hErr } = await supabase
        .from("hotels")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();

      if (hErr || !hotelRow) {
        throw new Error(
          hErr?.message || "Failed to load hotel for slug (Supabase)",
        );
      }

      hRaw = hotelRow;
      sRaw = {}; // no extra settings row in this fallback

      // Fetch Guest Info
      const { data: guestInfo } = await supabase
        .from("hotel_guest_info")
        .select("*")
        .eq("hotel_id", hotelRow.id)
        .maybeSingle();

      if (guestInfo) {
        sRaw = { ...sRaw, ...guestInfo };
      }


      const themeBrand =
        sRaw.brand_color ||
        hRaw.brand_color ||
        hRaw.theme?.brand ||
        "#145AF2";
      const themeMode: Theme["mode"] =
        hRaw.theme?.mode === "dark" ? "dark" : "light";

      const normalizedHotel: Hotel = {
        id: hRaw.id,
        slug: hRaw.slug,
        name: hRaw.name,
        description: hRaw.description || "",
        address: hRaw.address || "",
        amenities: Array.isArray(hRaw.amenities) ? hRaw.amenities : [],
        phone: sRaw.contact_phone || hRaw.phone || "",
        email: sRaw.contact_email || hRaw.email || "",
        logo_url: sRaw.logo_url || hRaw.logo_url || "",
        theme: { brand: themeBrand, mode: themeMode },
        upi_id: hRaw.upi_id || "",

        // Operations & Tax Fields
        default_checkin_time: hRaw.default_checkin_time || "14:00",
        default_checkout_time: hRaw.default_checkout_time || "11:00",
        early_checkin_allowed: hRaw.early_checkin_allowed ?? false,
        late_checkout_allowed: hRaw.late_checkout_allowed ?? false,
        timezone: hRaw.timezone || "Asia/Kolkata",
        currency_code: hRaw.currency_code || "INR",
        tax_percentage: hRaw.tax_percentage ?? null,
        service_charge_percentage: hRaw.service_charge_percentage ?? null,
        invoice_prefix: hRaw.invoice_prefix || "",
        invoice_counter: hRaw.invoice_counter ?? 1,
        legal_name: hRaw.legal_name || "",
        gst_number: hRaw.gst_number || "",

        // Guest Amenity Fields (from hotel_guest_info joined into sRaw)
        wifi_ssid: sRaw.wifi_ssid || "",
        wifi_password: sRaw.wifi_password || "",
        breakfast_start: sRaw.breakfast_start || "07:00",
        breakfast_end: sRaw.breakfast_end || "10:30",
        guest_notes: sRaw.notes || "",
      };

      setHotel(normalizedHotel);
      setAmenitiesCsv(toCsv(normalizedHotel.amenities));
    } catch (e: any) {
      const msg =
        e?.message === "Failed to fetch"
          ? "Could not reach the Owner Settings API / database. Please confirm your VAiyu backend and Supabase are reachable."
          : e?.message || "Failed to load settings";
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  // --- Guest menu / scan share URL + WhatsApp text (uses /scan) ---
  const shareUrl = useMemo(() => {
    if (!hotel?.slug) return "";
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "https://vaiyu.co.in";
    return `${origin}/scan?hotel=${encodeURIComponent(hotel.slug)}`;
  }, [hotel?.slug]);

  const whatsappText = useMemo(() => {
    if (!shareUrl) return "";
    const hotelName = hotel?.name || "our hotel";
    return (
      `Welcome to ${hotelName}! 👋\n\n` +
      `Use this link during your stay to open the VAiyu guest menu (services + food) and request housekeeping or amenities:\n` +
      `${shareUrl}`
    );
  }, [hotel?.name, shareUrl]);

  function patchHotel<K extends keyof Hotel>(key: K, val: Hotel[K]) {
    setHotel((p) => (p ? { ...p, [key]: val } : p));
  }
  function patchTheme<K extends keyof Theme>(key: K, val: Theme[K]) {
    setHotel((p) =>
      p ? { ...p, theme: { ...(p.theme || {}), [key]: val } } : p,
    );
  }


  async function save() {
    if (!hotel) return;

    setSaving(true);
    setErr(null);
    setOk(null);

    try {
      const hotelPayload = {
        name: hotel.name?.trim(),
        description: hotel.description?.trim(),
        address: hotel.address?.trim(),
        amenities: fromCsv(amenitiesCsv),
        phone: hotel.phone?.trim(),
        email: hotel.email?.trim(),
        logo_url: hotel.logo_url?.trim(),
        theme: hotel.theme,
        upi_id: hotel.upi_id?.trim(),

        // Operations & Tax
        default_checkin_time: hotel.default_checkin_time,
        default_checkout_time: hotel.default_checkout_time,
        early_checkin_allowed: hotel.early_checkin_allowed,
        late_checkout_allowed: hotel.late_checkout_allowed,
        timezone: hotel.timezone,
        currency_code: hotel.currency_code,
        tax_percentage: hotel.tax_percentage ? +hotel.tax_percentage : null,
        service_charge_percentage: hotel.service_charge_percentage ? +hotel.service_charge_percentage : null,
        invoice_prefix: hotel.invoice_prefix || null,
        invoice_counter: hotel.invoice_counter || 1,
        legal_name: hotel.legal_name?.trim() || null,
        gst_number: hotel.gst_number?.trim() || null,

        // Guest Info
        wifi_ssid: hotel.wifi_ssid?.trim() || null,
        wifi_password: hotel.wifi_password?.trim() || null,
        breakfast_start: hotel.breakfast_start || null,
        breakfast_end: hotel.breakfast_end || null,
        guest_notes: hotel.guest_notes?.trim() || null,
      };

      // ---- Write directly to Supabase via RPC ----
      // Use our robust Onboarding update RPC to handle both `hotels` and `hotel_guest_info` safely inside a transaction
      const { error: hotelErr } = await supabase.rpc('update_hotel_settings_onboarding', {
        p_hotel_id: hotel.id,
        p_action: 'HOTEL_SETTINGS_UPDATED',
        payload: {
          name: hotelPayload.name,
          description: hotelPayload.description,
          address: hotelPayload.address,
          amenities: hotelPayload.amenities,
          phone: hotelPayload.phone,
          email: hotelPayload.email,
          logo_path: hotelPayload.logo_url, // Map to RPC arg name
          theme: hotelPayload.theme,
          upi_id: hotelPayload.upi_id,

          // Operations & Tax
          default_checkin_time: hotelPayload.default_checkin_time,
          default_checkout_time: hotelPayload.default_checkout_time,
          early_checkin_allowed: hotelPayload.early_checkin_allowed,
          late_checkout_allowed: hotelPayload.late_checkout_allowed,
          timezone: hotelPayload.timezone,
          currency_code: hotelPayload.currency_code,
          tax_percentage: hotelPayload.tax_percentage,
          service_charge_percentage: hotelPayload.service_charge_percentage,
          invoice_prefix: hotelPayload.invoice_prefix,
          invoice_counter: hotelPayload.invoice_counter,
          legal_name: hotelPayload.legal_name,
          gst_number: hotelPayload.gst_number,

          // Guest Info
          wifi_ssid: hotelPayload.wifi_ssid,
          wifi_password: hotelPayload.wifi_password,
          breakfast_start: hotelPayload.breakfast_start,
          breakfast_end: hotelPayload.breakfast_end,
          guest_notes: hotelPayload.guest_notes
        }
      });

      if (hotelErr) {
        throw new Error(
          hotelErr.message || "Failed to update hotel settings",
        );
      }



      setOk("Saved successfully.");
      await load();
    } catch (e: any) {
      const msg =
        e?.message === "Failed to fetch"
          ? "Could not reach the Owner Settings API / database while saving. Please check your connection and try again."
          : e?.message || "Failed to save";
      setErr(msg);
    } finally {
      setSaving(false);
    }
  }

  const themePreviewStyle = {
    background: hotel?.theme?.brand || "#145AF2",
    color: "#fff",
    borderRadius: 12,
    padding: 12,
  };

  const menuSlug = hotel?.slug || slug;

  return (
    <>
      <SEO title="Owner Settings" noIndex />
      <OwnerGate>
        <main className="min-h-screen bg-slate-950 pb-12">
          <div className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-400 mb-4 mt-2">
              <Link to={hotel?.slug ? `/owner/${hotel.slug}` : '/owner'} className="hover:text-amber-500 transition">Dashboard</Link>
              <span className="text-slate-600">/</span>
              <span className="text-slate-100">Settings</span>
            </div>
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold text-slate-100">Owner Settings</h1>
                <div className="text-sm text-slate-400">
                  Branding, contact &amp; payments
                </div>
              </div>
              <div className="flex items-center gap-3">
                {hotel?.id && <UsageMeter hotelId={hotel.id} />}
                <div className="flex gap-2">
                  <input
                    className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 w-32"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="hotel slug"
                    title="Hotel slug to load"
                  />
                  <button
                    type="button"
                    className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/10 transition-colors"
                    onClick={load}
                    disabled={loading}
                  >
                    {loading ? "Loading…" : "Reload"}
                  </button>
                </div>
              </div>
            </header>

            {err && (
              <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm text-amber-200">
                ⚠️ {err}
              </div>
            )}
            {ok && (
              <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                ✅ {ok}
              </div>
            )}

            {hotel && (
              <div className="space-y-6">
                {/* Identity */}
                <section className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6 space-y-4">
                  <div className="grid md:grid-cols-2 gap-3">
                    <label className="text-sm font-medium text-slate-200 block">
                      Name
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        value={hotel.name}
                        onChange={(e) => patchHotel("name", e.target.value)}
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-200 block">
                      Slug (read-only)
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-400 cursor-not-allowed"
                        value={hotel.slug}
                        disabled
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-200 block md:col-span-2">
                      Description
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        value={hotel.description || ""}
                        onChange={(e) =>
                          patchHotel("description", e.target.value)
                        }
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-200 block md:col-span-2">
                      Address
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        value={hotel.address || ""}
                        onChange={(e) => patchHotel("address", e.target.value)}
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-200 block">
                      Phone
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        value={hotel.phone || ""}
                        onChange={(e) => patchHotel("phone", e.target.value)}
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-200 block">
                      Email
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        value={hotel.email || ""}
                        onChange={(e) => patchHotel("email", e.target.value)}
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-200 block md:col-span-2">
                      Logo URL
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        value={hotel.logo_url || ""}
                        onChange={(e) => patchHotel("logo_url", e.target.value)}
                      />
                    </label>
                  </div>

                  <div className="grid md:grid-cols-2 gap-3 pt-2">
                    <label className="text-sm font-medium text-slate-200 block">
                      Brand color
                      <input
                        type="color"
                        className="mt-1 border rounded w-28 h-10"
                        value={hotel.theme?.brand || "#145AF2"}
                        onChange={(e) => patchTheme("brand", e.target.value)}
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-200 block">
                      Theme mode
                      <select
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        value={hotel.theme?.mode || "light"}
                        onChange={(e) =>
                          patchTheme("mode", e.target.value as Theme["mode"])
                        }
                      >
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                      </select>
                    </label>
                  </div>

                  <div className="grid gap-3 pt-2">
                    <label className="text-sm font-medium text-slate-200 block">
                      Amenities (CSV)
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        value={amenitiesCsv}
                        onChange={(e) => setAmenitiesCsv(e.target.value)}
                        placeholder="WiFi, Parking, Breakfast"
                      />
                    </label>
                  </div>
                </section>

                {/* Legal & Invoice Settings */}
                <section className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6 space-y-4">
                  <div className="mb-4"><h3 className="text-lg font-bold text-slate-100">Legal &amp; Invoice Settings</h3></div>

                  <div className="grid md:grid-cols-2 gap-3">
                    <label className="text-sm font-medium text-slate-200 block">
                      Legal Entity Name
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        value={hotel.legal_name || ""}
                        onChange={(e) => patchHotel("legal_name", e.target.value)}
                        placeholder="Registered Company Name"
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-200 block">
                      Tax / GST Number
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 uppercase"
                        value={hotel.gst_number || ""}
                        onChange={(e) => patchHotel("gst_number", e.target.value)}
                        placeholder="e.g. 29ABCDE1234F1Z5"
                      />
                    </label>
                  </div>

                  <div className="grid md:grid-cols-4 gap-3 pt-2">
                    <label className="text-sm font-medium text-slate-200 block md:col-span-1">
                      Tax %
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        value={hotel.tax_percentage || ""}
                        onChange={(e) => patchHotel("tax_percentage", e.target.value ? +e.target.value : null)}
                        placeholder="18"
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-200 block md:col-span-1">
                      Service Charge %
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        value={hotel.service_charge_percentage || ""}
                        onChange={(e) => patchHotel("service_charge_percentage", e.target.value ? +e.target.value : null)}
                        placeholder="5"
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-200 block md:col-span-1">
                      Invoice Prefix
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 uppercase"
                        value={hotel.invoice_prefix || ""}
                        onChange={(e) => patchHotel("invoice_prefix", e.target.value)}
                        placeholder="INV-"
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-200 block md:col-span-1">
                      Next Invoice #
                      <input
                        type="number"
                        min="1"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        value={hotel.invoice_counter || 1}
                        onChange={(e) => patchHotel("invoice_counter", e.target.value ? parseInt(e.target.value) : 1)}
                      />
                    </label>
                  </div>
                </section>

                {/* Operations */}
                <section className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6 space-y-4">
                  <div className="mb-4"><h3 className="text-lg font-bold text-slate-100">Operations &amp; Policies</h3></div>
                  <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
                    <label className="text-sm font-medium text-slate-200 block">
                      Default Check-in
                      <input
                        type="time"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        value={hotel.default_checkin_time || "14:00"}
                        onChange={(e) => patchHotel("default_checkin_time", e.target.value)}
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-200 block">
                      Default Check-out
                      <input
                        type="time"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        value={hotel.default_checkout_time || "11:00"}
                        onChange={(e) => patchHotel("default_checkout_time", e.target.value)}
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-200 block">
                      Timezone
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        value={hotel.timezone || "Asia/Kolkata"}
                        onChange={(e) => patchHotel("timezone", e.target.value)}
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-200 block">
                      Currency Code
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 uppercase"
                        value={hotel.currency_code || "INR"}
                        onChange={(e) => patchHotel("currency_code", e.target.value)}
                      />
                    </label>
                  </div>

                  <div className="flex gap-6 mt-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!hotel.early_checkin_allowed}
                        onChange={(e) => patchHotel("early_checkin_allowed", e.target.checked)}
                        className="rounded border-white/10 bg-white/5 w-4 h-4 text-amber-500 focus:ring-amber-500 focus:ring-offset-slate-900 cursor-pointer"
                      />
                      Allow Early Check-in
                    </label>
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!hotel.late_checkout_allowed}
                        onChange={(e) => patchHotel("late_checkout_allowed", e.target.checked)}
                        className="rounded border-white/10 bg-white/5 w-4 h-4 text-amber-500 focus:ring-amber-500 focus:ring-offset-slate-900 cursor-pointer"
                      />
                      Allow Late Check-out
                    </label>
                  </div>
                </section>

                {/* Guest Amenities / Wi-Fi & Breakfast */}
                <section className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6 space-y-4">
                  <div className="mb-4"><h3 className="text-lg font-bold text-slate-100">Guest Information</h3></div>

                  <div className="grid md:grid-cols-2 gap-3">
                    <label className="text-sm font-medium text-slate-200 block">
                      Wi-Fi SSID (Network Name)
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        value={hotel.wifi_ssid || ""}
                        onChange={(e) => patchHotel("wifi_ssid", e.target.value)}
                        placeholder="Vaiyu_Guest"
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-200 block">
                      Wi-Fi Password
                      <input
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        value={hotel.wifi_password || ""}
                        onChange={(e) => patchHotel("wifi_password", e.target.value)}
                        placeholder="welcome123"
                      />
                    </label>
                  </div>

                  <div className="grid md:grid-cols-2 gap-3 pt-2">
                    <label className="text-sm font-medium text-slate-200 block">
                      Breakfast Start Time
                      <input
                        type="time"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        value={hotel.breakfast_start || "07:00"}
                        onChange={(e) => patchHotel("breakfast_start", e.target.value)}
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-200 block">
                      Breakfast End Time
                      <input
                        type="time"
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        value={hotel.breakfast_end || "10:30"}
                        onChange={(e) => patchHotel("breakfast_end", e.target.value)}
                      />
                    </label>
                  </div>

                  <div className="pt-2">
                    <label className="text-sm font-medium text-slate-200 block">
                      Guest Notes &amp; Instructions
                      <textarea
                        className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[80px]"
                        value={hotel.guest_notes || ""}
                        onChange={(e) => patchHotel("guest_notes", e.target.value)}
                        placeholder="Pool timing, emergency numbers, or standard property rules..."
                      />
                    </label>
                    <p className="text-xs text-slate-400 mt-1">This information will be displayed to guests on their dashboard after they check in.</p>
                  </div>
                </section>



                {/* Microsite Preview */}
                <section className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6 space-y-2">
                  <div className="text-sm text-slate-400">Microsite preview</div>
                  <div style={themePreviewStyle} className="rounded-xl overflow-hidden p-4">
                    <div className="text-xs opacity-90">Property microsite</div>
                    <div className="text-xl font-semibold">
                      {hotel.name || "Hotel"}
                    </div>
                    <div className="text-sm opacity-90">
                      {hotel.address || "Address"} • {hotel.phone || "Phone"}
                    </div>
                  </div>
                </section>

                {/* Guest link (WhatsApp + QR) */}
                <section className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-medium text-slate-100">Guest link (WhatsApp + QR)</h2>
                    {shareUrl && (
                      <a
                        href={`https://wa.me/?text=${encodeURIComponent(
                          whatsappText || shareUrl,
                        )}`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-4 py-2 font-medium text-slate-200 hover:bg-white/10 transition-colors !py-1.5 !px-3 text-xs"
                      >
                        Open in WhatsApp
                      </a>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    Share this link with guests at check-in. It opens your VAiyu
                    Scan screen, which then routes them to the in-room menu and
                    services for this property.
                  </p>

                  <div className="grid md:grid-cols-[2fr,1fr] gap-4 items-start pt-2">
                    <div className="space-y-4">
                      <label className="text-xs font-medium text-slate-400 block">
                        Guest scan link
                        <input
                          className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                          value={shareUrl || ""}
                          readOnly
                          onFocus={(e) => e.currentTarget.select()}
                        />
                      </label>
                      <label className="text-xs font-medium text-slate-400 block">
                        WhatsApp message template
                        <textarea
                          className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[100px]"
                          value={whatsappText || ""}
                          readOnly
                          onFocus={(e) => e.currentTarget.select()}
                        />
                      </label>
                    </div>
                    <div className="flex flex-col items-center justify-center p-4 border border-white/10 rounded-xl bg-white/5">
                      {shareUrl ? (
                        <>
                          <div className="text-xs text-slate-400 mb-3 text-center">
                            QR for room standee / table tent
                          </div>
                          <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
                              shareUrl,
                            )}`}
                            alt="QR code for guest menu"
                            className="bg-white p-2 border rounded-lg"
                          />
                        </>
                      ) : (
                        <div className="text-xs text-slate-500 text-center py-8">
                          Slug missing – save hotel first to enable sharing.
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* UPI / Payment Settings */}
                <section className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6 space-y-4">
                  <div className="font-semibold">Payments &amp; UPI</div>
                  <div className="grid md:grid-cols-2 gap-3 items-start">
                    <div>
                      <label className="text-sm font-medium text-slate-200 block">
                        UPI ID / VPA
                        <input
                          className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                          value={hotel.upi_id || ""}
                          onChange={(e) => patchHotel("upi_id", e.target.value)}
                          placeholder="e.g. business@upi"
                        />
                      </label>
                      <p className="text-xs text-slate-400 mt-1">
                        This UPI ID will be used to generate payment QR codes for guest bills.
                      </p>
                    </div>
                    <div className="flex flex-col items-center justify-center p-4 border rounded bg-white/5">
                      {hotel.upi_id ? (
                        <>
                          <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(
                              `upi://pay?pa=${hotel.upi_id}&pn=${encodeURIComponent(hotel.name)}&cu=INR`
                            )}`}
                            alt="UPI QR Preview"
                            className="w-32 h-32"
                          />
                          <span className="text-xs text-green-600 mt-2 font-medium">Preview</span>
                        </>
                      ) : (
                        <span className="text-xs text-slate-500 italic">Enter UPI ID to see QR preview</span>
                      )}
                    </div>
                  </div>
                </section>

                <div className="flex gap-2">
                  <button className="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 transition-colors" onClick={save} disabled={saving}>
                    {saving ? "Saving…" : "Save settings"}
                  </button>
                  <button
                    className="btn inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/10 transition-colors"
                    onClick={load}
                    disabled={loading}
                  >
                    Revert
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </OwnerGate>
    </>
  );
}
