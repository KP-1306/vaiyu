import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { API } from "../lib/api";

// Lightweight country suggestions without shipping a big dataset
const SUGGESTED_COUNTRIES = [
  "India","United Arab Emirates","United States","United Kingdom","Singapore","Thailand","Nepal","Bhutan","Sri Lanka","Indonesia"
];

const PROPERTY_TYPES = ["Hotel","Resort","Villa","Homestay","Hostel","Other"] as const;

type PropertyType = (typeof PROPERTY_TYPES)[number];

const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3 MB

type FormState = {
  property_name: string;
  property_type: PropertyType | "";
  city: string;
  country: string;
  map_link?: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  room_count?: number | "";
  links: string[]; // website / instagram / listing links
};

export default function OwnerRegister() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>({
    property_name: "",
    property_type: "",
    city: "",
    country: "India",
    map_link: "",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    room_count: "",
    links: [""]
  });

  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateLink(i: number, value: string) {
    setForm((f) => {
      const links = [...f.links];
      links[i] = value;
      return { ...f, links };
    });
  }

  function addLink() {
    setForm((f) => ({ ...f, links: [...f.links, ""] }));
  }

  function removeLink(i: number) {
    setForm((f) => ({ ...f, links: f.links.filter((_, idx) => idx !== i) }));
  }

  function validate(): string | null {
    if (!form.property_name.trim()) return "Property name is required.";
    if (!form.property_type) return "Property type is required.";
    if (!form.city.trim()) return "City is required.";
    if (!form.country.trim()) return "Country is required.";
    if (!form.contact_name.trim()) return "Owner / Primary contact name is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact_email)) return "Enter a valid email address.";
    if (!/^\+?[0-9\-\s()]{7,20}$/.test(form.contact_phone)) return "Enter a valid phone number.";
    if (form.map_link && !/^https?:\/\//i.test(form.map_link)) return "Google Map link must start with http or https.";
    for (const link of form.links) {
      if (!link) continue; // empty optional rows allowed
      if (!/^https?:\/\//i.test(link)) return "Each website/Instagram link must start with http or https.";
    }
    if (coverFile && coverFile.size > MAX_IMAGE_BYTES) return "Cover image must be \u2264 3 MB.";
    if (coverFile && !/^image\/(png|jpe?g|webp)$/i.test(coverFile.type)) return "Cover image must be PNG, JPG, or WEBP.";
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const v = validate();
    if (v) { setErr(v); return; }

    setSubmitting(true); setOk(null); setErr(null);
    try {
      // Prepare multipart form to send JSON + optional file
      const fd = new FormData();
      const payload = {
        property_name: form.property_name.trim(),
        property_type: form.property_type,
        city: form.city.trim(),
        country: form.country.trim(),
        map_link: form.map_link?.trim() || undefined,
        contact_name: form.contact_name.trim(),
        contact_email: form.contact_email.trim(),
        contact_phone: form.contact_phone.trim(),
        room_count: form.room_count === "" ? undefined : Number(form.room_count),
        links: form.links.filter(Boolean).map((s) => s.trim())
      };

      // Append JSON payload as a part named `data` (backend can parse it)
      fd.append("data", new Blob([JSON.stringify(payload)], { type: "application/json" }));
      if (coverFile) fd.append("cover_file", coverFile, coverFile.name);

      const r = await fetch(`${API}/owner/register`, { method: "POST", body: fd });
      if (!r.ok) throw new Error("Could not submit application");

      setOk("Thanks! We’ve received your property details. Our team will review and contact you soon.");
      setForm({
        property_name: "",
        property_type: "",
        city: "",
        country: "India",
        map_link: "",
        contact_name: "",
        contact_email: "",
        contact_phone: "",
        room_count: "",
        links: [""]
      });
      setCoverFile(null);
      if (coverPreview) { URL.revokeObjectURL(coverPreview); setCoverPreview(null); }

      // Optionally: navigate("/thanks");
    } catch (e: any) {
      setErr(e?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-[75vh] bg-gradient-to-b from-white to-slate-50">
      <section className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <Link to="/" className="text-sm text-slate-600 hover:underline">← Back home</Link>
        </div>

        <div className="rounded-2xl shadow-sm border bg-white overflow-hidden">
          <div className="px-6 py-5 border-b bg-slate-50">
            <h1 className="text-2xl font-semibold">Register your property</h1>
            <p className="text-sm text-slate-600 mt-1">Tell us a bit about your place. We’ll review and help complete the formalities — fast.</p>
          </div>

          {/* Notices */}
          {ok && <div className="mx-6 mt-4 rounded-md bg-green-50 text-green-800 p-3 text-sm">{ok}</div>}
          {err && <div className="mx-6 mt-4 rounded-md bg-red-50 text-red-700 p-3 text-sm">{err}</div>}

          {/* Form */}
          <form className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6" onSubmit={onSubmit}>
            {/* Property name */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium">Property name<span className="text-red-500">*</span></label>
              <input className="mt-1 w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300" required
                value={form.property_name} onChange={(e)=>update("property_name", e.target.value)} placeholder="e.g., Lakeview Retreat"/>
            </div>

            {/* Property type */}
            <div>
              <label className="block text-sm font-medium">Property type<span className="text-red-500">*</span></label>
              <select className="mt-1 w-full rounded-xl border px-3 py-2 bg-white" required
                value={form.property_type} onChange={(e)=>update("property_type", e.target.value as PropertyType)}>
                <option value="" disabled>Choose type</option>
                {PROPERTY_TYPES.map((t)=> (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {/* City */}
            <div>
              <label className="block text-sm font-medium">City<span className="text-red-500">*</span></label>
              <input className="mt-1 w-full rounded-xl border px-3 py-2" required
                value={form.city} onChange={(e)=>update("city", e.target.value)} placeholder="e.g., Nainital"/>
            </div>

            {/* Country */}
            <div>
              <label className="block text-sm font-medium">Country<span className="text-red-500">*</span></label>
              <input list="countries" className="mt-1 w-full rounded-xl border px-3 py-2" required
                value={form.country} onChange={(e)=>update("country", e.target.value)} placeholder="e.g., India"/>
              <datalist id="countries">
                {SUGGESTED_COUNTRIES.map((c)=> (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            {/* Google Map link */}
            <div>
              <label className="block text-sm font-medium">Google Map link</label>
              <input className="mt-1 w-full rounded-xl border px-3 py-2" inputMode="url"
                value={form.map_link} onChange={(e)=>update("map_link", e.target.value)} placeholder="https://maps.google.com/..."/>
            </div>

            {/* Contact name */}
            <div>
              <label className="block text-sm font-medium">Owner / Primary contact name<span className="text-red-500">*</span></label>
              <input className="mt-1 w-full rounded-xl border px-3 py-2" required
                value={form.contact_name} onChange={(e)=>update("contact_name", e.target.value)} placeholder="Your full name"/>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium">Email<span className="text-red-500">*</span></label>
              <input type="email" className="mt-1 w-full rounded-xl border px-3 py-2" required
                value={form.contact_email} onChange={(e)=>update("contact_email", e.target.value)} placeholder="name@company.com"/>
            </div>

            {/* Phone */}
            <div>
              <label className="block text-sm font-medium">Phone<span className="text-red-500">*</span></label>
              <input className="mt-1 w-full rounded-xl border px-3 py-2" required inputMode="tel" pattern="\+?[0-9\-\s()]{7,20}"
                value={form.contact_phone} onChange={(e)=>update("contact_phone", e.target.value)} placeholder="e.g., +91 98765 43210"/>
            </div>

            {/* Room count */}
            <div>
              <label className="block text-sm font-medium">Approx. room count</label>
              <input type="number" min={0} className="mt-1 w-full rounded-xl border px-3 py-2"
                value={form.room_count} onChange={(e)=>update("room_count", e.target.value === "" ? "" : Number(e.target.value))} placeholder="e.g., 24"/>
            </div>

            {/* Links (dynamic) */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium">Property website / page / Instagram URL(s)</label>
              <div className="space-y-2 mt-1">
                {form.links.map((link, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input className="flex-1 rounded-xl border px-3 py-2" inputMode="url" placeholder="https://…"
                      value={link} onChange={(e)=>updateLink(i, e.target.value)} />
                    {form.links.length > 1 && (
                      <button type="button" onClick={()=>removeLink(i)} className="px-3 py-2 rounded-xl border text-slate-700">Remove</button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={addLink} className="text-sm underline">+ Add another link</button>
              </div>
            </div>

            {/* Cover image upload */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium">Property cover image (upload)</label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="mt-1 block w-full text-sm"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  if (file && file.size > MAX_IMAGE_BYTES) {
                    setErr("Cover image must be \u2264 3 MB.");
                    e.currentTarget.value = "";
                    return;
                  }
                  setCoverFile(file);
                  if (coverPreview) URL.revokeObjectURL(coverPreview);
                  setCoverPreview(file ? URL.createObjectURL(file) : null);
                }}
              />
              {coverPreview && (
                <div className="mt-2">
                  <img src={coverPreview} alt="Cover preview" className="h-28 rounded-lg border object-cover" />
                  <p className="text-xs text-slate-500 mt-1">Preview only — final will be uploaded on submit.</p>
                </div>
              )}
            </div>

            {/* Submit */}
            <div className="md:col-span-2 mt-2">
              <button className="w-full rounded-xl bg-blue-600 text-white py-2.5 font-medium hover:bg-blue-700 disabled:opacity-60"
                type="submit" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit for approval"}
              </button>
              <p className="text-xs text-slate-500 mt-2 text-center">By submitting, you agree that a VAiyu specialist may contact you to verify details.</p>
            </div>
          </form>
        </div>

        {/* Footer nav */}
        <div className="text-sm text-slate-600 mt-4 flex items-center gap-3">
          <Link to="/" className="underline">Go back</Link>
          <span aria-hidden>•</span>
          <button onClick={()=>navigate(-1)} className="underline">Previous page</button>
        </div>
      </section>
    </main>
  );
}
