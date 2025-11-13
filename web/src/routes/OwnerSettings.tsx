// web/src/routes/OwnerSettings.tsx

import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import OwnerGate from "../components/OwnerGate"; // if you gate the page; otherwise remove
import SEO from "../components/SEO";
import UsageMeter from "../components/UsageMeter";

const API = import.meta.env.VITE_API_URL as string;

// -------- Types --------
type Theme = { brand?: string; mode?: "light" | "dark" };

type ReviewsPolicy = {
  mode?: "off" | "preview" | "auto";
  min_activity?: number;
  block_if_late_exceeds?: number;
  require_consent?: boolean;
};

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
  reviews_policy?: ReviewsPolicy;
};

type Service = {
  key: string;
  label: string | null;
  sla_minutes: number | null;
  active: boolean;
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
  // which hotel to edit
  const [slug, setSlug] = useState<string>(
    () => new URLSearchParams(location.search).get("slug") || "TENANT1"
  );

  // hotel + services state
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [amenitiesCsv, setAmenitiesCsv] = useState("");

  // ui state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // forward the current Supabase session
  const sessionHeaders = useMemo(() => {
    // supabase-js v2: getSession() is async; we’ll also try the internal accessor for SSR-less apps
    const token = (supabase as any)?.auth?.session?.()?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const load = useCallback(async () => {
    setErr(null);
    setOk(null);
    setLoading(true);
    try {
      const r = await fetch(
        `${API}/owner-settings?slug=${encodeURIComponent(slug)}`,
        {
          headers: { "content-type": "application/json", ...sessionHeaders },
        }
      );
      const data = await r.json();
      if (!r.ok || !data?.ok)
        throw new Error(data?.error || "Failed to load settings");

      const h: Hotel = data.hotel;
      const svcs: Service[] = data.services || [];

      setHotel({
        id: h.id,
        slug: h.slug,
        name: h.name,
        description: h.description || "",
        address: h.address || "",
        amenities: h.amenities || [],
        phone: h.phone || "",
        email: h.email || "",
        logo_url: h.logo_url || "",
        theme: h.theme || { brand: "#145AF2", mode: "light" },
        reviews_policy:
          h.reviews_policy || {
            mode: "preview",
            min_activity: 1,
            block_if_late_exceeds: 0,
            require_consent: true,
          },
      });
      setAmenitiesCsv(toCsv(h.amenities));
      setServices(svcs);
    } catch (e: any) {
      setErr(e?.message || "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [slug, sessionHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  // --- Guest menu share URL + WhatsApp text (NEW) ---
  const shareUrl = useMemo(() => {
    if (!hotel?.slug) return "";
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "https://vaiyu.co.in";
    return `${origin}/menu?hotelSlug=${encodeURIComponent(hotel.slug)}`;
  }, [hotel?.slug]);

  const whatsappText = useMemo(() => {
    if (!shareUrl) return "";
    const hotelName = hotel?.name || "our hotel";
    return (
      `Welcome to ${hotelName}! 👋\n\n` +
      `Use this link during your stay to request housekeeping, amenities or room service:\n` +
      `${shareUrl}`
    );
  }, [hotel?.name, shareUrl]);

  function patchHotel<K extends keyof Hotel>(key: K, val: Hotel[K]) {
    setHotel((p) => (p ? { ...p, [key]: val } : p));
  }
  function patchTheme<K extends keyof Theme>(key: K, val: Theme[K]) {
    setHotel((p) =>
      p ? { ...p, theme: { ...(p.theme || {}), [key]: val } } : p
    );
  }
  function patchPolicy<K extends keyof ReviewsPolicy>(
    key: K,
    val: ReviewsPolicy[K]
  ) {
    setHotel((p) =>
      p
        ? { ...p, reviews_policy: { ...(p.reviews_policy || {}), [key]: val } }
        : p
    );
  }
  function updateService(idx: number, patch: Partial<Service>) {
    setServices((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }
  function addService() {
    setServices((prev) => [
      ...prev,
      { key: "", label: "", sla_minutes: 30, active: true },
    ]);
  }

  async function save() {
    if (!hotel) return;
    setSaving(true);
    setErr(null);
    setOk(null);
    try {
      const body = {
        hotel: {
          name: hotel.name?.trim(),
          description: hotel.description?.trim(),
          address: hotel.address?.trim(),
          amenities: fromCsv(amenitiesCsv),
          phone: hotel.phone?.trim(),
          email: hotel.email?.trim(),
          logo_url: hotel.logo_url?.trim(),
          theme: hotel.theme,
          reviews_policy: {
            mode: hotel.reviews_policy?.mode || "preview",
            min_activity: Number(hotel.reviews_policy?.min_activity ?? 1),
            block_if_late_exceeds: Number(
              hotel.reviews_policy?.block_if_late_exceeds ?? 0
            ),
            require_consent: !!hotel.reviews_policy?.require_consent,
          },
        },
        services: services.map((s) => ({
          key: String(s.key || "").trim(),
          label: (s.label ?? "").toString().trim() || null,
          sla_minutes:
            s.sla_minutes == null || Number.isNaN(Number(s.sla_minutes))
              ? null
              : Math.max(1, Math.trunc(Number(s.sla_minutes))),
          active: !!s.active,
        })),
      };

      const r = await fetch(
        `${API}/owner-settings?slug=${encodeURIComponent(slug)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", ...sessionHeaders },
          body: JSON.stringify(body),
        }
      );
      const data = await r.json();
      if (!r.ok || !data?.ok) throw new Error(data?.error || "Failed to save");
      setOk("Saved successfully.");
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to save");
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

  return (
    <>
      <SEO title="Owner Settings" noIndex />
      <OwnerGate>
        <main className="max-w-5xl mx-auto p-4 space-y-4">
          <header className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">Owner Settings</h1>
              <div className="text-sm text-gray-600">
                Branding, contact, reviews policy &amp; service SLAs
              </div>
            </div>
            <div className="flex gap-2">
              <input
                className="input"
                style={{ width: 180 }}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="hotel slug"
                title="Hotel slug to load"
              />
              <button
                className="btn btn-light"
                onClick={load}
                disabled={loading}
              >
                {loading ? "Loading…" : "Reload"}
              </button>
            </div>
          </header>

          {/* Optional usage meter (kept import; you can render it when you have profile */}
          {/* <UsageMeter hotelId={...} /> */}

          {err && (
            <div className="card" style={{ borderColor: "#f59e0b" }}>
              ⚠️ {err}
            </div>
          )}
          {ok && (
            <div className="card" style={{ borderColor: "#10b981" }}>
              ✅ {ok}
            </div>
          )}

          {hotel && (
            <>
              {/* Identity */}
              <section className="bg-white rounded shadow p-4 space-y-3">
                <div className="grid md:grid-cols-2 gap-3">
                  <label className="text-sm">
                    Name
                    <input
                      className="mt-1 input w-full"
                      value={hotel.name}
                      onChange={(e) => patchHotel("name", e.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    Slug (read-only)
                    <input
                      className="mt-1 input w-full bg-gray-50"
                      value={hotel.slug}
                      disabled
                    />
                  </label>
                  <label className="text-sm md:col-span-2">
                    Description
                    <input
                      className="mt-1 input w-full"
                      value={hotel.description || ""}
                      onChange={(e) =>
                        patchHotel("description", e.target.value)
                      }
                    />
                  </label>
                  <label className="text-sm md:col-span-2">
                    Address
                    <input
                      className="mt-1 input w-full"
                      value={hotel.address || ""}
                      onChange={(e) => patchHotel("address", e.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    Phone
                    <input
                      className="mt-1 input w-full"
                      value={hotel.phone || ""}
                      onChange={(e) => patchHotel("phone", e.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    Email
                    <input
                      className="mt-1 input w-full"
                      value={hotel.email || ""}
                      onChange={(e) => patchHotel("email", e.target.value)}
                    />
                  </label>
                  <label className="text-sm md:col-span-2">
                    Logo URL
                    <input
                      className="mt-1 input w-full"
                      value={hotel.logo_url || ""}
                      onChange={(e) => patchHotel("logo_url", e.target.value)}
                    />
                  </label>
                </div>

                <div className="grid md:grid-cols-2 gap-3 pt-2">
                  <label className="text-sm">
                    Brand color
                    <input
                      type="color"
                      className="mt-1 border rounded w-28 h-10"
                      value={hotel.theme?.brand || "#145AF2"}
                      onChange={(e) => patchTheme("brand", e.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    Theme mode
                    <select
                      className="mt-1 select w-full"
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
                  <label className="text-sm">
                    Amenities (CSV)
                    <input
                      className="mt-1 input w-full"
                      value={amenitiesCsv}
                      onChange={(e) => setAmenitiesCsv(e.target.value)}
                      placeholder="WiFi, Parking, Breakfast"
                    />
                  </label>
                </div>
              </section>

              {/* Reviews Policy */}
              <section className="bg-white rounded shadow p-4 space-y-3">
                <div className="font-semibold">Reviews / Experience Policy</div>
                <div className="grid md:grid-cols-2 gap-3">
                  <label className="text-sm">
                    Mode
                    <select
                      className="mt-1 select w-full"
                      value={hotel.reviews_policy?.mode || "preview"}
                      onChange={(e) =>
                        patchPolicy(
                          "mode",
                          e.target.value as ReviewsPolicy["mode"]
                        )
                      }
                    >
                      <option value="off">Off — never generate</option>
                      <option value="preview">Preview — draft for guest</option>
                      <option value="auto">
                        Auto — publish at checkout (respect rules)
                      </option>
                    </select>
                  </label>
                  <label className="text-sm">
                    Require consent
                    <select
                      className="mt-1 select w-full"
                      value={String(!!hotel.reviews_policy?.require_consent)}
                      onChange={(e) =>
                        patchPolicy(
                          "require_consent",
                          e.target.value === "true"
                        )
                      }
                    >
                      <option value="true">Yes (recommended)</option>
                      <option value="false">No</option>
                    </select>
                  </label>
                  <label className="text-sm">
                    Min. activity (tickets + orders)
                    <input
                      type="number"
                      min={0}
                      className="mt-1 input w-full"
                      value={Number(hotel.reviews_policy?.min_activity ?? 1)}
                      onChange={(e) =>
                        patchPolicy("min_activity", Number(e.target.value))
                      }
                    />
                  </label>
                  <label className="text-sm">
                    Block if late requests &gt;
                    <input
                      type="number"
                      min={0}
                      className="mt-1 input w-full"
                      value={Number(
                        hotel.reviews_policy?.block_if_late_exceeds ?? 0
                      )}
                      onChange={(e) =>
                        patchPolicy(
                          "block_if_late_exceeds",
                          Number(e.target.value)
                        )
                      }
                    />
                  </label>
                </div>
                <p className="text-xs text-gray-600">
                  <b>Preview</b> shows an AI draft the guest can edit/approve.{" "}
                  <b>Auto</b> can publish at checkout, but will be blocked if
                  consent is required or thresholds aren’t met.
                </p>
              </section>

              {/* Microsite Preview */}
              <section className="bg-white rounded shadow p-4 space-y-2">
                <div className="text-sm text-gray-600">Microsite preview</div>
                <div style={themePreviewStyle}>
                  <div className="text-xs opacity-90">Property microsite</div>
                  <div className="text-xl font-semibold">
                    {hotel.name || "Hotel"}
                  </div>
                  <div className="text-sm opacity-90">
                    {hotel.address || "Address"} • {hotel.phone || "Phone"}
                  </div>
                </div>
              </section>

              {/* NEW: WhatsApp / QR share block */}
              <section className="bg-white rounded shadow p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-medium">Guest link (WhatsApp + QR)</h2>
                  {shareUrl && (
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(
                        whatsappText || shareUrl
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-light !py-1.5 !px-3 text-xs"
                    >
                      Open in WhatsApp
                    </a>
                  )}
                </div>
                <p className="text-xs text-gray-600">
                  Share this link with guests at check-in. It opens your
                  VAiyu-powered menu (services + food) for this property.
                </p>

                <div className="grid md:grid-cols-[2fr,1fr] gap-3 items-start">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-gray-600">
                      Guest menu link
                      <input
                        className="mt-1 input w-full text-xs"
                        value={shareUrl || ""}
                        readOnly
                        onFocus={(e) => e.currentTarget.select()}
                      />
                    </label>
                    <label className="text-xs font-medium text-gray-600">
                      WhatsApp message template
                      <textarea
                        className="mt-1 input w-full text-xs min-h-[80px]"
                        value={whatsappText || ""}
                        readOnly
                        onFocus={(e) => e.currentTarget.select()}
                      />
                    </label>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    {shareUrl ? (
                      <>
                        <div className="text-xs text-gray-600 mb-1">
                          QR for room standee / table tent
                        </div>
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
                            shareUrl
                          )}`}
                          alt="QR code for guest menu"
                          className="border rounded"
                        />
                      </>
                    ) : (
                      <div className="text-xs text-gray-500 text-center">
                        Slug missing – save hotel first to enable sharing.
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* Services & SLAs */}
              <section className="bg-white rounded shadow p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-medium">Services &amp; SLAs</h2>
                  <button
                    className="btn btn-light !py-2 !px-3 text-sm"
                    onClick={addService}
                  >
                    + Add service
                  </button>
                </div>

                <div className="overflow-auto mt-3">
                  <table className="min-w-[720px] w-full text-sm border">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-3 py-2 border-b">Key</th>
                        <th className="text-left px-3 py-2 border-b">Label</th>
                        <th className="text-left px-3 py-2 border-b">
                          SLA (min)
                        </th>
                        <th className="text-left px-3 py-2 border-b">Active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {services.map((s, i) => (
                        <tr key={i} className="border-b">
                          <td className="px-3 py-2">
                            <input
                              className="w-full rounded-md border px-2 py-1"
                              value={s.key}
                              onChange={(e) =>
                                updateService(i, { key: e.target.value })
                              }
                              placeholder="HOUSEKEEPING"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              className="w-full rounded-md border px-2 py-1"
                              value={s.label || ""}
                              onChange={(e) =>
                                updateService(i, { label: e.target.value })
                              }
                              placeholder="Housekeeping"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={1}
                              className="w-28 rounded-md border px-2 py-1"
                              value={s.sla_minutes ?? ""}
                              onChange={(e) =>
                                updateService(i, {
                                  sla_minutes:
                                    e.target.value === ""
                                      ? null
                                      : Math.max(
                                          1,
                                          Math.trunc(
                                            Number(e.target.value) || 1
                                          )
                                        ),
                                })
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={!!s.active}
                              onChange={(e) =>
                                updateService(i, {
                                  active: e.target.checked,
                                })
                              }
                            />
                          </td>
                        </tr>
                      ))}
                      {services.length === 0 && (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-3 py-6 text-center text-gray-500"
                          >
                            No services yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <div className="flex gap-2">
                <button className="btn" onClick={save} disabled={saving}>
                  {saving ? "Saving…" : "Save settings"}
                </button>
                <button
                  className="btn btn-light"
                  onClick={load}
                  disabled={loading}
                >
                  Revert
                </button>
              </div>
            </>
          )}
        </main>
      </OwnerGate>
    </>
  );
}
