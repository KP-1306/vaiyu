// web/src/routes/OwnerRegister.tsx
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { API } from "../lib/api";
import { supabase } from "../lib/supabase";
import { useOwnerT } from "../i18n/useOwnerT";

// Lightweight country suggestions without shipping a big dataset
const SUGGESTED_COUNTRIES = [
  "India",
  "United Arab Emirates",
  "United States",
  "United Kingdom",
  "Singapore",
  "Thailand",
  "Nepal",
  "Bhutan",
  "Sri Lanka",
  "Indonesia",
] as const;

const PROPERTY_TYPES = ["Hotel", "Resort", "Villa", "Homestay", "Hostel", "Other"] as const;
type PropertyType = (typeof PROPERTY_TYPES)[number];

const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3 MB
const ENDPOINT = `${API}/owner/register`;

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
  links: string[];
};

export default function OwnerRegister() {
  const navigate = useNavigate();
  const t = useOwnerT("owner-register");

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
    links: [""],
  });

  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false); // lock UI after success
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Cleanup preview URL if component unmounts or image changes
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
    if (!form.property_name.trim()) return t("err.propertyNameRequired", "Property name is required.");
    if (!form.property_type) return t("err.propertyTypeRequired", "Property type is required.");
    if (!form.city.trim()) return t("err.cityRequired", "City is required.");
    if (!form.country.trim()) return t("err.countryRequired", "Country is required.");
    if (!form.contact_name.trim()) return t("err.contactNameRequired", "Owner / Primary contact name is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact_email)) return t("err.emailInvalid", "Enter a valid email address.");
    if (!/^\+?[0-9\-\s()]{7,20}$/.test(form.contact_phone)) return t("err.phoneInvalid", "Enter a valid phone number.");
    if (form.map_link && !/^https?:\/\//i.test(form.map_link)) return t("err.mapLinkInvalid", "Google Map link must start with http or https.");

    for (const link of form.links) {
      if (!link) continue; // allow empty optional rows
      if (!/^https?:\/\//i.test(link)) return t("err.linkInvalid", "Each website/Instagram link must start with http or https.");
    }

    if (coverFile && coverFile.size > MAX_IMAGE_BYTES) return t("err.imageTooLarge", "Cover image must be ≤ 3 MB.");
    if (coverFile && !/^image\/(png|jpe?g|webp)$/i.test(coverFile.type))
      return t("err.imageType", "Cover image must be PNG, JPG, or WEBP.");
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || submitted) return;

    const v = validate();
    if (v) {
      setErr(v);
      return;
    }

    setSubmitting(true);
    setOk(null);
    setErr(null);

    try {
      // Supabase auth token (if user is signed in)
      const { data: sessionRes } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;
      const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

      // Build payload used for both JSON and multipart
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
        links: form.links.filter(Boolean).map((s) => s.trim()),
      };

      let res: Response;

      if (coverFile) {
        // Multipart (let the browser set the correct boundary)
        const fd = new FormData();
        fd.append("data", new Blob([JSON.stringify(payload)], { type: "application/json" }));
        fd.append("cover_file", coverFile, coverFile.name);

        res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { ...authHeader }, // don't set Content-Type for multipart
          body: fd,
        });
      } else {
        // Pure JSON
        res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        // Try to surface backend response (json or text)
        let detail = "";
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const j = await res.json().catch(() => ({}));
          detail = j.message || j.error || JSON.stringify(j);
        } else {
          detail = await res.text().catch(() => "");
        }
        throw new Error(detail || t("err.submitFailed", "Could not submit application (HTTP {{status}})", { status: res.status }));
      }

      setOk(t("ok.submitted", "Thanks! We've received your property details. Our team will review and contact you soon."));
      setSubmitted(true);

      // Optional reset (UI stays locked)
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
        links: [""],
      });
      setCoverFile(null);
      if (coverPreview) {
        URL.revokeObjectURL(coverPreview);
        setCoverPreview(null);
      }
      // navigate("/thanks");
    } catch (e: any) {
      setErr(e?.message || t("err.generic", "Something went wrong. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-[75vh] bg-gradient-to-b from-white to-slate-50">
      <section className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <Link to="/" className="text-sm text-slate-600 hover:underline">
            {t("nav.backHome", "← Back home")}
          </Link>
        </div>

        <div className="rounded-2xl shadow-sm border bg-white overflow-hidden">
          <div className="px-6 py-5 border-b bg-slate-50">
            <h1 className="text-2xl font-semibold">{t("page.title", "Register your property")}</h1>
            <p className="text-sm text-slate-600 mt-1">
              {t("page.subtitle", "Tell us a bit about your place. We'll review and help complete the formalities — fast.")}
            </p>
          </div>

          {ok && <div className="mx-6 mt-4 rounded-md bg-green-50 text-green-800 p-3 text-sm">{ok}</div>}
          {err && <div className="mx-6 mt-4 rounded-md bg-red-50 text-red-700 p-3 text-sm">{err}</div>}

          <form className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6" onSubmit={onSubmit}>
            {/* Disable all fields when submitting OR after a successful submit */}
            <fieldset disabled={submitting || submitted} className="contents">
              {/* Property name */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium">
                  {t("form.propertyName", "Property name")}<span className="text-red-500">*</span>
                </label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  required
                  value={form.property_name}
                  onChange={(e) => update("property_name", e.target.value)}
                  placeholder={t("form.propertyNamePlaceholder", "e.g., Lakeview Retreat")}
                />
              </div>

              {/* Property type */}
              <div>
                <label className="block text-sm font-medium">
                  {t("form.propertyType", "Property type")}<span className="text-red-500">*</span>
                </label>
                <select
                  className="mt-1 w-full rounded-xl border px-3 py-2 bg-white"
                  required
                  value={form.property_type}
                  onChange={(e) => update("property_type", e.target.value as PropertyType)}
                >
                  <option value="" disabled>
                    {t("form.propertyTypeDefault", "Choose type")}
                  </option>
                  {PROPERTY_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              {/* City */}
              <div>
                <label className="block text-sm font-medium">
                  {t("form.city", "City")}<span className="text-red-500">*</span>
                </label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  required
                  value={form.city}
                  onChange={(e) => update("city", e.target.value)}
                  placeholder={t("form.cityPlaceholder", "e.g., Nainital")}
                />
              </div>

              {/* Country */}
              <div>
                <label className="block text-sm font-medium">
                  {t("form.country", "Country")}<span className="text-red-500">*</span>
                </label>
                <input
                  list="countries"
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  required
                  value={form.country}
                  onChange={(e) => update("country", e.target.value)}
                  placeholder={t("form.countryPlaceholder", "e.g., India")}
                />
                <datalist id="countries">
                  {SUGGESTED_COUNTRIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              {/* Google Map link */}
              <div>
                <label className="block text-sm font-medium">{t("form.mapLink", "Google Map link")}</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  inputMode="url"
                  value={form.map_link}
                  onChange={(e) => update("map_link", e.target.value)}
                  placeholder="https://maps.google.com/..."
                />
              </div>

              {/* Contact name */}
              <div>
                <label className="block text-sm font-medium">
                  {t("form.contactName", "Owner / Primary contact name")}<span className="text-red-500">*</span>
                </label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  required
                  value={form.contact_name}
                  onChange={(e) => update("contact_name", e.target.value)}
                  placeholder={t("form.contactNamePlaceholder", "Your full name")}
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium">
                  {t("form.email", "Email")}<span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  required
                  value={form.contact_email}
                  onChange={(e) => update("contact_email", e.target.value)}
                  placeholder={t("form.emailPlaceholder", "name@company.com")}
                />
              </div>

              {/* Phone */}
              <div>
                <label className="block text-sm font-medium">
                  {t("form.phone", "Phone")}<span className="text-red-500">*</span>
                </label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  required
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  pattern={"^\\+?[0-9\\s()\\-]{7,20}$"}
                  title={t("form.phoneTitle", "Phone number: optional '+' then 7–20 digits/spaces/()/-")}
                  value={form.contact_phone}
                  onChange={(e) => update("contact_phone", e.target.value)}
                  placeholder={t("form.phonePlaceholder", "e.g., +91 98765 43210")}
                />
              </div>

              {/* Room count */}
              <div>
                <label className="block text-sm font-medium">{t("form.roomCount", "Approx. room count")}</label>
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full rounded-xl border px-3 py-2"
                  value={form.room_count}
                  onChange={(e) =>
                    update("room_count", e.target.value === "" ? "" : Number(e.target.value))
                  }
                  placeholder={t("form.roomCountPlaceholder", "e.g., 24")}
                />
              </div>

              {/* Links */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium">{t("form.links", "Property website / page / Instagram URL(s)")}</label>
                <div className="space-y-2 mt-1">
                  {form.links.map((link, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input
                        className="flex-1 rounded-xl border px-3 py-2"
                        inputMode="url"
                        placeholder="https://…"
                        value={link}
                        onChange={(e) => updateLink(i, e.target.value)}
                      />
                      {form.links.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLink(i)}
                          className="px-3 py-2 rounded-xl border text-slate-700"
                        >
                          {t("form.removeLink", "Remove")}
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={addLink} className="text-sm underline">
                    {t("form.addLink", "+ Add another link")}
                  </button>
                </div>
              </div>

              {/* Cover image */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium">{t("form.coverImage", "Property cover image (upload)")}</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="mt-1 block w-full text-sm"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    if (file && file.size > MAX_IMAGE_BYTES) {
                      setErr(t("err.imageTooLarge", "Cover image must be ≤ 3 MB."));
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
                    <img
                      src={coverPreview}
                      alt={t("form.coverPreviewAlt", "Cover preview")}
                      className="h-28 rounded-lg border object-cover"
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      {t("form.coverPreviewNote", "Preview only — final will be uploaded on submit.")}
                    </p>
                  </div>
                )}
              </div>
            </fieldset>

            {/* Submit */}
            <div className="md:col-span-2 mt-2">
              <button
                className="w-full rounded-xl bg-blue-600 text-white py-2.5 font-medium hover:bg-blue-700 disabled:opacity-60"
                type="submit"
                disabled={submitting || submitted}
              >
                {submitted ? t("form.submittedBtn", "Submitted") : submitting ? t("form.submittingBtn", "Submitting…") : t("form.submitBtn", "Submit for approval")}
              </button>
              <p className="text-xs text-slate-500 mt-2 text-center">
                {t("form.consent", "By submitting, you agree that a VAiyu specialist may contact you to verify details.")}
              </p>
            </div>
          </form>
        </div>

        {/* Footer nav */}
        <div className="text-sm text-slate-600 mt-4 flex items-center gap-3">
          <Link to="/" className="underline">
            {t("nav.goBack", "Go back")}
          </Link>
          <span aria-hidden>•</span>
          <button onClick={() => navigate(-1)} className="underline">
            {t("nav.previousPage", "Previous page")}
          </button>
        </div>
      </section>
    </main>
  );
}
