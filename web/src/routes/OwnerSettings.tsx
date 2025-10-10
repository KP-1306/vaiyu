// web/src/routes/OwnerSettings.tsx
import { useEffect, useState } from "react";
import { getHotel, upsertHotel } from "../lib/api";
import { useTheme } from "../components/ThemeProvider";

type HotelForm = {
  hotelName: string;
  slug: string;
  city: string;
  address: string;
  phone: string;
  email: string;
  brandColor: string;
  logoUrl: string;
  roomsCsv: string;      // local only (no API yet)
  amenitiesCsv: string;  // maps to API amenities[]
  dark: boolean;         // UI-only checkbox (maps to theme.mode)
  description?: string;
};

const KEY = "owner:settings:hotel";

function csvToArray(csv: string) {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
function arrayToCsv(arr?: string[]) {
  return (arr || []).join(", ");
}

export default function OwnerSettings() {
  const { setTheme } = useTheme();

  const [f, setF] = useState<HotelForm>({
    hotelName: "",
    slug: "sunrise",
    city: "",
    address: "",
    phone: "",
    email: "",
    brandColor: "#0ea5e9",
    logoUrl: "",
    roomsCsv: "201,202,203,204,205",
    amenitiesCsv: "Free Wi-Fi, 24x7 Front Desk, Room Service",
    dark: false,
    description: "",
  });
  const [savedAt, setSavedAt] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>("");

  // hydrate from local backup once
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        setF((p) => ({ ...p, ...obj, dark: !!obj.dark }));
        if (obj.__savedAt) setSavedAt(obj.__savedAt);
        // apply theme preview from saved
        setTheme({ brand: obj.brandColor || p.brandColor, mode: obj.dark ? "dark" : "light" });
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // live theme preview when brand/dark change
  useEffect(() => {
    setTheme({ brand: f.brandColor, mode: f.dark ? "dark" : "light" });
  }, [f.brandColor, f.dark, setTheme]);

  function up<K extends keyof HotelForm>(k: K, v: HotelForm[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }

  function saveLocal() {
    const payload = { ...f, __savedAt: new Date().toISOString() };
    localStorage.setItem(KEY, JSON.stringify(payload));
    setSavedAt(payload.__savedAt);
    setMsg("Saved locally.");
    setTimeout(() => setMsg(""), 1500);
  }

  async function loadFromServer() {
    setLoading(true);
    setMsg("");
    try {
      const h = await getHotel(f.slug);
      // map API → form
      setF((p) => ({
        ...p,
        hotelName: h.name || p.hotelName,
        slug: h.slug || p.slug,
        city: p.city, // not in API yet
        address: h.address || "",
        phone: h.phone || "",
        email: h.email || "",
        logoUrl: h.logo_url || "",
        brandColor: h?.theme?.brand || p.brandColor,
        dark: (h?.theme?.mode || "light") === "dark",
        amenitiesCsv: arrayToCsv(h?.amenities),
        description: h?.description || "",
      }));
      setMsg("Loaded from server.");
    } catch (e: any) {
      setMsg(e?.message || "Failed to load from server");
    } finally {
      setLoading(false);
      setTimeout(() => setMsg(""), 1500);
    }
  }

  async function saveToServer() {
    setLoading(true);
    setMsg("");
    try {
      const payload = {
        slug: f.slug.trim(),
        name: f.hotelName.trim() || "Hotel",
        description: f.description?.trim(),
        address: [f.address, f.city].filter(Boolean).join(", "),
        phone: f.phone.trim(),
        email: f.email.trim(),
        logo_url: f.logoUrl.trim(),
        amenities: csvToArray(f.amenitiesCsv),
        theme: { brand: f.brandColor, mode: f.dark ? "dark" : "light" as const },
      };
      const res = await upsertHotel(payload);
      // reflect any normalized values from server back in form (slug/name/theme, etc.)
      setF((p) => ({
        ...p,
        slug: res.slug || p.slug,
        hotelName: res.name || p.hotelName,
        address: res.address || p.address,
        phone: res.phone || p.phone,
        email: res.email || p.email,
        logoUrl: res.logo_url || p.logoUrl,
        amenitiesCsv: arrayToCsv(res.amenities),
        brandColor: res?.theme?.brand || p.brandColor,
        dark: (res?.theme?.mode || "light") === "dark",
        description: res?.description || p.description,
      }));
      setMsg("Saved to server.");
    } catch (e: any) {
      setMsg(e?.message || "Failed to save to server");
    } finally {
      setLoading(false);
      setTimeout(() => setMsg(""), 1500);
    }
  }

  function clearAll() {
    if (!confirm("Clear all saved settings locally?")) return;
    localStorage.removeItem(KEY);
    window.location.reload();
  }

  function exportJson() {
    const data = { ...f, __savedAt: savedAt || new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${f.slug || "hotel"}-settings.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="max-w-3xl mx-auto p-4">
      <div className="flex items-start justify-between">
        <h1 className="text-xl font-semibold mb-3">Owner Settings / Onboarding</h1>
        <div className="text-right">
          {!!savedAt && (
            <div className="mb-1 text-xs text-gray-600">
              Local backup: {new Date(savedAt).toLocaleString()}
            </div>
          )}
          {msg && <div className="text-xs text-emerald-700">{msg}</div>}
        </div>
      </div>

      <div className="bg-white rounded shadow p-4 space-y-3">
        <div className="grid md:grid-cols-2 gap-3">
          <label className="text-sm">
            Slug (no spaces)
            <input
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.slug}
              onChange={(e) => up("slug", e.target.value)}
              placeholder="sunrise"
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              onClick={loadFromServer}
              className="px-3 py-2 bg-white rounded border"
              disabled={loading || !f.slug.trim()}
              title="Fetch current configuration from API"
            >
              {loading ? "Loading…" : "Load from server"}
            </button>
            <button
              onClick={saveToServer}
              className="px-3 py-2 bg-sky-600 text-white rounded"
              disabled={loading || !f.slug.trim()}
              title="Save configuration to API"
            >
              {loading ? "Saving…" : "Save to server"}
            </button>
          </div>

          <label className="text-sm md:col-span-2">
            Hotel name
            <input
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.hotelName}
              onChange={(e) => up("hotelName", e.target.value)}
              placeholder="Sunrise Resort"
            />
          </label>

          <label className="text-sm md:col-span-2">
            Short description
            <input
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.description}
              onChange={(e) => up("description", e.target.value)}
              placeholder="Hill-view stay powered by VAiyu"
            />
          </label>

          <label className="text-sm">
            City
            <input
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.city}
              onChange={(e) => up("city", e.target.value)}
              placeholder="Manali"
            />
          </label>
          <label className="text-sm">
            Phone
            <input
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.phone}
              onChange={(e) => up("phone", e.target.value)}
              placeholder="+91 98xxxxxxx"
            />
          </label>
          <label className="text-sm md:col-span-2">
            Address
            <input
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.address}
              onChange={(e) => up("address", e.target.value)}
              placeholder="Street, Area, City, PIN"
            />
          </label>
          <label className="text-sm md:col-span-2">
            Email
            <input
              type="email"
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.email}
              onChange={(e) => up("email", e.target.value)}
              placeholder="reservations@hotel.com"
            />
          </label>
        </div>

        <div className="grid md:grid-cols-2 gap-3 pt-2">
          <label className="text-sm">
            Brand color
            <input
              type="color"
              className="mt-1 border rounded w-32 h-9"
              value={f.brandColor}
              onChange={(e) => up("brandColor", e.target.value)}
            />
          </label>
          <label className="text-sm">
            Theme mode
            <div className="mt-1 flex items-center gap-2">
              <label className="text-sm flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={f.dark}
                  onChange={(e) => up("dark", e.target.checked)}
                />
                Use dark mode
              </label>
            </div>
          </label>
          <label className="text-sm md:col-span-2">
            Logo URL (optional)
            <input
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.logoUrl}
              onChange={(e) => up("logoUrl", e.target.value)}
              placeholder="https://..."
            />
          </label>
          <label className="text-sm md:col-span-2">
            Amenities (CSV)
            <input
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.amenitiesCsv}
              onChange={(e) => up("amenitiesCsv", e.target.value)}
              placeholder="WiFi, Parking, Breakfast"
            />
          </label>
          <label className="text-sm md:col-span-2">
            Rooms (CSV) <span className="text-xs text-gray-500">(stored locally for now)</span>
            <input
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.roomsCsv}
              onChange={(e) => up("roomsCsv", e.target.value)}
              placeholder="101,102,201,202"
            />
          </label>
        </div>

        <div className="pt-2 flex flex-wrap gap-2">
          <button onClick={saveLocal} className="px-4 py-2 bg-white rounded border">
            Save locally
          </button>
          <button onClick={exportJson} className="px-4 py-2 bg-white rounded border">
            Export JSON
          </button>
          <button onClick={clearAll} className="px-4 py-2 bg-white rounded border">
            Clear
          </button>
        </div>
      </div>

      {/* Live preview card */}
      <section className="mt-4 bg-white rounded shadow p-4">
        <div className="text-sm text-gray-600 mb-2">Live Preview (uses ThemeProvider)</div>
        <div
          className="rounded p-3 text-white"
          style={{ background: f.brandColor || "#0ea5e9" }}
        >
          <div className="text-xs opacity-90">Property microsite</div>
          <div className="text-xl font-semibold">{f.hotelName || "Hotel"}</div>
          <div className="text-sm opacity-90">
            {(f.city || "").trim() || "City"} • {(f.phone || "").trim() || "Phone"}
          </div>
        </div>
      </section>

      {/* Logo preview */}
      {f.logoUrl && (
        <section className="mt-3">
          <div className="text-sm text-gray-600 mb-1">Logo preview</div>
          <img
            src={f.logoUrl}
            alt="Hotel logo"
            style={{ width: 80, height: 80, borderRadius: 12, objectFit: "cover", border: "1px solid var(--border)" }}
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
          />
        </section>
      )}
    </main>
  );
}
