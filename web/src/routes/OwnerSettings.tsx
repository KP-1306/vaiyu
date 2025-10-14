import { useEffect, useMemo, useState, useCallback } from 'react';
import { getHotel, upsertHotel } from '../lib/api';
import OwnerGate from '../components/OwnerGate';
import SEO from "../components/SEO";

type Theme = { brand?: string; mode?: 'light' | 'dark' };

type ReviewsPolicy = {
  mode?: 'off' | 'preview' | 'auto';
  min_activity?: number;
  block_if_late_exceeds?: number;
  require_consent?: boolean;
};

type HotelPayload = {
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
  // not persisted here, but we allow editing a CSV to seed rooms in future
  roomsCsv?: string;
};

<SEO title="Owner Home" noIndex />

function toCsv(arr?: string[]) {
  return (arr || []).join(', ');
}
function fromCsv(s: string) {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

export default function OwnerSettings() {
  // which hotel to edit
  const [slug, setSlug] = useState<string>(() => new URLSearchParams(location.search).get('slug') || 'sunrise');

  // form state
  const [form, setForm] = useState<HotelPayload>({
    slug: 'sunrise',
    name: '',
    description: '',
    address: '',
    amenities: [],
    phone: '',
    email: '',
    logo_url: '',
    theme: { brand: '#145AF2', mode: 'light' },
    reviews_policy: {
      mode: 'preview',
      min_activity: 1,
      block_if_late_exceeds: 0,
      require_consent: true,
    },
    roomsCsv: '201,202,203,204',
  });

  const [amenitiesCsv, setAmenitiesCsv] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // load hotel
  const load = useCallback(async () => {
    setErr(null);
    setOk(null);
    setLoading(true);
    try {
      const h = await getHotel(slug);
      const amenities = (h as any).amenities || [];
      setForm((p) => ({
        ...p,
        slug: (h as any).slug || slug,
        name: (h as any).name || '',
        description: (h as any).description || '',
        address: (h as any).address || '',
        amenities,
        phone: (h as any).phone || '',
        email: (h as any).email || '',
        logo_url: (h as any).logo_url || '',
        theme: (h as any).theme || { brand: '#145AF2', mode: 'light' },
        reviews_policy:
          (h as any).reviews_policy || { mode: 'preview', min_activity: 1, block_if_late_exceeds: 0, require_consent: true },
      }));
      setAmenitiesCsv(toCsv(amenities));
    } catch (e: any) {
      setErr(e?.message || 'Failed to load hotel');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  function set<K extends keyof HotelPayload>(key: K, val: HotelPayload[K]) {
    setForm((p) => ({ ...p, [key]: val }));
  }
  function setTheme<K extends keyof Theme>(key: K, val: Theme[K]) {
    setForm((p) => ({ ...p, theme: { ...(p.theme || {}), [key]: val } }));
  }
  function setPolicy<K extends keyof ReviewsPolicy>(key: K, val: ReviewsPolicy[K]) {
    setForm((p) => ({ ...p, reviews_policy: { ...(p.reviews_policy || {}), [key]: val } }));
  }

  async function save() {
    setErr(null);
    setOk(null);
    setSaving(true);
    try {
      const payload: HotelPayload = {
        slug: form.slug.trim(),
        name: form.name.trim(),
        description: form.description?.trim(),
        address: form.address?.trim(),
        amenities: fromCsv(amenitiesCsv),
        phone: form.phone?.trim(),
        email: form.email?.trim(),
        logo_url: form.logo_url?.trim(),
        theme: form.theme,
        reviews_policy: {
          mode: form.reviews_policy?.mode || 'preview',
          min_activity: Number(form.reviews_policy?.min_activity ?? 1),
          block_if_late_exceeds: Number(form.reviews_policy?.block_if_late_exceeds ?? 0),
          require_consent: !!form.reviews_policy?.require_consent,
        },
      };
      await upsertHotel(payload);
      setOk('Saved.');
      // if slug changed, reflect in query string
      if (slug !== payload.slug) {
        const usp = new URLSearchParams(location.search);
        usp.set('slug', payload.slug);
        history.replaceState({}, '', `${location.pathname}?${usp.toString()}`);
        setSlug(payload.slug);
      }
    } catch (e: any) {
      setErr(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const themePreviewStyle = useMemo(
    () => ({
      background: form.theme?.brand || '#145AF2',
      color: '#fff',
      borderRadius: 12,
      padding: 12,
    }),
    [form.theme?.brand]
  );

  return (
    <OwnerGate>
      <main className="max-w-3xl mx-auto p-4 space-y-4">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Owner Settings</h1>
            <div className="text-sm text-gray-600">Branding, contact, and **Reviews policy**</div>
          </div>
          <div className="flex gap-2">
            <input
              className="input"
              style={{ width: 160 }}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="hotel slug"
              title="Hotel slug to load"
            />
            <button className="btn btn-light" onClick={load} disabled={loading}>
              Reload
            </button>
          </div>
        </header>

        {err && <div className="card" style={{ borderColor: '#f59e0b' }}>⚠️ {err}</div>}
        {ok && <div className="card" style={{ borderColor: '#10b981' }}>✅ {ok}</div>}
        {loading && <div>Loading…</div>}

        {!loading && (
          <>
            {/* Identity */}
            <section className="bg-white rounded shadow p-4 space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <label className="text-sm">
                  Name
                  <input className="mt-1 input w-full" value={form.name} onChange={(e) => set('name', e.target.value)} />
                </label>
                <label className="text-sm">
                  Slug
                  <input className="mt-1 input w-full" value={form.slug} onChange={(e) => set('slug', e.target.value)} />
                </label>
                <label className="text-sm md:col-span-2">
                  Description
                  <input className="mt-1 input w-full" value={form.description} onChange={(e) => set('description', e.target.value)} />
                </label>
                <label className="text-sm md:col-span-2">
                  Address
                  <input className="mt-1 input w-full" value={form.address} onChange={(e) => set('address', e.target.value)} />
                </label>
                <label className="text-sm">
                  Phone
                  <input className="mt-1 input w-full" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
                </label>
                <label className="text-sm">
                  Email
                  <input className="mt-1 input w-full" value={form.email} onChange={(e) => set('email', e.target.value)} />
                </label>
                <label className="text-sm md:col-span-2">
                  Logo URL
                  <input className="mt-1 input w-full" value={form.logo_url} onChange={(e) => set('logo_url', e.target.value)} />
                </label>
              </div>

              <div className="grid md:grid-cols-2 gap-3 pt-2">
                <label className="text-sm">
                  Brand color
                  <input
                    type="color"
                    className="mt-1 border rounded w-28 h-10"
                    value={form.theme?.brand || '#145AF2'}
                    onChange={(e) => setTheme('brand', e.target.value)}
                  />
                </label>
                <label className="text-sm">
                  Theme mode
                  <select
                    className="mt-1 select w-full"
                    value={form.theme?.mode || 'light'}
                    onChange={(e) => setTheme('mode', e.target.value as Theme['mode'])}
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
                <label className="text-sm">
                  Rooms (CSV) <span className="text-gray-500 text-xs">(preview only)</span>
                  <input
                    className="mt-1 input w-full"
                    value={form.roomsCsv}
                    onChange={(e) => set('roomsCsv', e.target.value)}
                    placeholder="101,102,201…"
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
                    value={form.reviews_policy?.mode || 'preview'}
                    onChange={(e) => setPolicy('mode', e.target.value as ReviewsPolicy['mode'])}
                  >
                    <option value="off">Off — never generate</option>
                    <option value="preview">Preview — draft for guest</option>
                    <option value="auto">Auto — publish at checkout (respect rules)</option>
                  </select>
                </label>
                <label className="text-sm">
                  Require consent
                  <select
                    className="mt-1 select w-full"
                    value={String(!!form.reviews_policy?.require_consent)}
                    onChange={(e) => setPolicy('require_consent', e.target.value === 'true')}
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
                    value={Number(form.reviews_policy?.min_activity ?? 1)}
                    onChange={(e) => setPolicy('min_activity', Number(e.target.value))}
                  />
                </label>
                <label className="text-sm">
                  Block if late requests &gt;
                  <input
                    type="number"
                    min={0}
                    className="mt-1 input w-full"
                    value={Number(form.reviews_policy?.block_if_late_exceeds ?? 0)}
                    onChange={(e) => setPolicy('block_if_late_exceeds', Number(e.target.value))}
                  />
                </label>
              </div>
              <p className="text-xs text-gray-600">
                <b>Preview</b> shows an AI draft the guest can edit/approve. <b>Auto</b> can publish at checkout, but will be blocked if consent is
                required or thresholds aren’t met.
              </p>
            </section>

            {/* Preview card */}
            <section className="bg-white rounded shadow p-4 space-y-2">
              <div className="text-sm text-gray-600">Microsite preview</div>
              <div style={themePreviewStyle}>
                <div className="text-xs opacity-90">Property microsite</div>
                <div className="text-xl font-semibold">{form.name || 'Hotel'}</div>
                <div className="text-sm opacity-90">{form.address || 'Address'} • {form.phone || 'Phone'}</div>
              </div>
            </section>

            <div className="flex gap-2">
              <button className="btn" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save settings'}
              </button>
              <button className="btn btn-light" onClick={load} disabled={loading}>
                Revert
              </button>
            </div>
          </>
        )}
      </main>
    </OwnerGate>
  );
}
