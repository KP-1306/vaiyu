import { useEffect, useState } from "react";
import { getHotel, upsertHotel } from '../lib/api';


type HotelForm = {
  hotelName: string;
  slug: string;
  city: string;
  address: string;
  phone: string;
  email: string;
  brandColor: string;
  logoUrl: string;
  roomsCsv: string;        // e.g. "101,102,201,202"
  amenitiesCsv: string;    // e.g. "WiFi, Parking, Breakfast"
};

const KEY = "owner:settings:hotel";

export default function OwnerSettings() {
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
  });
  const [savedAt, setSavedAt] = useState<string>("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        setF((p) => ({ ...p, ...obj }));
        if (obj.__savedAt) setSavedAt(obj.__savedAt);
      }
    } catch {}
  }, []);

  function up<K extends keyof HotelForm>(k: K, v: HotelForm[K]) {
    setF((p) => ({ ...p, [k]: v }));
  }

  function save() {
    const payload = { ...f, __savedAt: new Date().toISOString() };
    localStorage.setItem(KEY, JSON.stringify(payload));
    setSavedAt(payload.__savedAt);
    alert("Saved. (Stored locally for now; API hookup comes later.)");
  }

  function clearAll() {
    if (!confirm("Clear all saved settings?")) return;
    localStorage.removeItem(KEY);
    window.location.reload();
  }

  function exportJson() {
    const data = { ...f, __savedAt: savedAt || new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${f.slug || "hotel"}-settings.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="max-w-3xl mx-auto p-4">
      <h1 className="text-xl font-semibold mb-3">Owner Settings / Onboarding</h1>
      {savedAt && (
        <div className="mb-3 text-xs text-gray-600">
          Last saved: {new Date(savedAt).toLocaleString()}
        </div>
      )}

      <div className="bg-white rounded shadow p-4 space-y-3">
        <div className="grid md:grid-cols-2 gap-3">
          <label className="text-sm">
            Hotel name
            <input
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.hotelName}
              onChange={(e) => up("hotelName", e.target.value)}
              placeholder="Sunrise Resort"
            />
          </label>
          <label className="text-sm">
            Slug (no spaces)
            <input
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.slug}
              onChange={(e) => up("slug", e.target.value)}
              placeholder="sunrise"
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
            Logo URL (optional)
            <input
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.logoUrl}
              onChange={(e) => up("logoUrl", e.target.value)}
              placeholder="https://..."
            />
          </label>
          <label className="text-sm md:col-span-2">
            Rooms (CSV)
            <input
              className="mt-1 border rounded w-full px-2 py-1"
              value={f.roomsCsv}
              onChange={(e) => up("roomsCsv", e.target.value)}
              placeholder="101,102,201,202"
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
        </div>

        <div className="pt-2 flex gap-2">
          <button onClick={save} className="px-4 py-2 bg-sky-600 text-white rounded">
            Save settings
          </button>
          <button onClick={exportJson} className="px-4 py-2 bg-white rounded border">
            Export JSON
          </button>
          <button onClick={clearAll} className="px-4 py-2 bg-white rounded border">
            Clear
          </button>
        </div>
      </div>

      {/* Preview card */}
      <section className="mt-4 bg-white rounded shadow p-4">
        <div className="text-sm text-gray-600 mb-2">Preview</div>
        <div
          className="rounded p-3 text-white"
          style={{ background: f.brandColor || "#0ea5e9" }}
        >
          <div className="text-xs opacity-90">Property microsite</div>
          <div className="text-xl font-semibold">{f.hotelName || "Hotel"}</div>
          <div className="text-sm opacity-90">
            {f.city || "City"} • {f.phone || "Phone"}
          </div>
        </div>
      </section>
    </main>
  );
}
