import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Spinner from "../components/Spinner";
import BackHome from "../components/BackHome";

/** ---------- Types ---------- */
type ProfileRecord = {
  id?: string;                 // user id (uuid)
  // User Profile
  full_name: string;
  phone: string;
  email: string;
  // KYC
  govt_id_type: "Aadhar" | "DL" | "Passport" | "Voter ID" | "";
  govt_id_number: string;
  address: string;
  // Other
  emergency_name: string;
  emergency_phone: string;
  vehicle_number: string;
  // Consent
  consent_terms: boolean;
  updated_at?: string | null;
};

const EMPTY: ProfileRecord = {
  full_name: "",
  phone: "",
  email: "",
  govt_id_type: "",
  govt_id_number: "",
  address: "",
  emergency_name: "",
  emergency_phone: "",
  vehicle_number: "",
  consent_terms: false,
};

/** LocalStorage safety fallback key */
const LS_KEY = "va:profile";

/** Utility: simple phone & email checks (very light) */
const isPhone = (s: string) => /^[0-9+\-\s]{8,}$/.test(s.trim());
const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

/** Save + load with graceful Supabase fallback */
async function loadProfile(): Promise<{ data: ProfileRecord; source: "db" | "local" }> {
  const { data: sess } = await supabase.auth.getSession().catch(() => ({ data: { session: null } as any }));
  const user = sess?.session?.user;
  if (!user) {
    const cached = safeReadLocal();
    return { data: cached ?? { ...EMPTY, email: "" }, source: "local" };
  }

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      const rec = normalizeFromDb(data as any);
      safeWriteLocal(rec);
      return { data: rec, source: "db" };
    }

    // No row yet — prefill from auth
    const rec: ProfileRecord = {
      ...EMPTY,
      email: user.email ?? "",
      full_name: user.user_metadata?.full_name ?? "",
      phone: user.user_metadata?.phone ?? "",
    };
    return { data: rec, source: "db" };
  } catch {
    const cached = safeReadLocal();
    return { data: cached ?? { ...EMPTY, email: user?.email ?? "" }, source: "local" };
  }
}

async function saveProfile(next: ProfileRecord): Promise<"db" | "local"> {
  const { data: sess } = await supabase.auth.getSession().catch(() => ({ data: { session: null } as any }));
  const user = sess?.session?.user;

  if (!user) {
    safeWriteLocal(next);
    return "local";
  }

  try {
    const payload = normalizeToDb(user.id, next);
    const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "id" });
    if (error) throw error;
    safeWriteLocal(next);
    return "db";
  } catch {
    safeWriteLocal(next);
    return "local";
  }
}

/** ---------- Local cache helpers ---------- */
function safeReadLocal(): ProfileRecord | null {
  try {
    const s = localStorage.getItem(LS_KEY);
    return s ? (JSON.parse(s) as ProfileRecord) : null;
  } catch {
    return null;
  }
}
function safeWriteLocal(p: ProfileRecord) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {}
}

/** ---------- DB <-> UI normalization ---------- */
function normalizeFromDb(row: any): ProfileRecord {
  return {
    id: row.id,
    full_name: row.full_name ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    govt_id_type: row.govt_id_type ?? "",
    govt_id_number: row.govt_id_number ?? "",
    address: row.address ?? "",
    emergency_name: row.emergency_name ?? "",
    emergency_phone: row.emergency_phone ?? "",
    vehicle_number: row.vehicle_number ?? "",
    consent_terms: !!row.consent_terms,
    updated_at: row.updated_at ?? null,
  };
}
function normalizeToDb(id: string, p: ProfileRecord) {
  return {
    id,
    full_name: p.full_name || null,
    phone: p.phone || null,
    email: p.email || null,
    govt_id_type: p.govt_id_type || null,
    govt_id_number: p.govt_id_number || null,
    address: p.address || null,
    emergency_name: p.emergency_name || null,
    emergency_phone: p.emergency_phone || null,
    vehicle_number: p.vehicle_number || null,
    consent_terms: !!p.consent_terms,
    updated_at: new Date().toISOString(),
  };
}

/** ---------- UI ---------- */
export default function Profile() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [profile, setProfile] = useState<ProfileRecord>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"db" | "local">("local");
  const [savedOnce, setSavedOnce] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const res = await loadProfile();
      if (!mounted) return;
      setProfile(res.data);
      setSource(res.source);
      setMode(res.data.full_name || res.data.phone || res.data.govt_id_type ? "view" : "edit");
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  const requiredOk = useMemo(() => {
    if (!profile.full_name.trim()) return false;
    if (!isPhone(profile.phone)) return false;
    if (!isEmail(profile.email)) return false;
    if (!profile.govt_id_type) return false;
    if (!profile.govt_id_number.trim()) return false;
    if (!profile.consent_terms) return false;
    return true;
  }, [profile]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!requiredOk) {
      setError("Please complete all required fields marked with * and fix validation errors.");
      return;
    }
    setSaving(true);
    const where = await saveProfile(profile);
    setSaving(false);
    setSource(where);
    setMode("view");
    setSavedOnce(true);
  }

  if (loading) {
    return (
      <main className="min-h-[50vh] grid place-items-center">
        <Spinner label="Loading your profile…" />
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto p-6">
      <BackHome />

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Your profile</h1>
          <p className="text-sm text-gray-600 mt-1">
            Keep these handy — they speed up check-in and help us reach you in a pinch.
          </p>
        </div>

        {/* Back to dashboard on view mode */}
        {mode === "view" ? (
          <Link to="/guest" className="btn btn-light whitespace-nowrap">Back to dashboard</Link>
        ) : null}
      </header>

      {/* success banner */}
      {savedOnce && mode === "view" && (
        <div className="mt-4 rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm flex items-center justify-between">
          <span>✅ Profile updated successfully.</span>
          <div className="flex gap-2">
            <Link to="/guest" className="btn btn-light">Back to dashboard</Link>
            <button className="btn btn-light" onClick={() => setSavedOnce(false)}>Dismiss</button>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-2xl border bg-white/90 shadow-sm">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="text-xs text-gray-600">
            Saved in <span className="font-medium">{source === "db" ? "Cloud (Supabase)" : "This device"}</span>
          </div>
          {mode === "view" ? (
            <button className="btn btn-light" onClick={() => setMode("edit")}>Edit</button>
          ) : (
            <div className="flex gap-2">
              <button className="btn btn-light" onClick={() => setMode("view")}>Cancel</button>
              <button className="btn" onClick={handleSave} disabled={saving || !requiredOk}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          )}
        </div>

        {/* Friendly, sectioned form */}
        <form className="p-5 grid gap-6">
          <CardSection
            emoji="🧑‍💼"
            title="User profile"
            blurb="How we address you & get in touch."
          >
            <Field
              label="Full name *"
              value={profile.full_name}
              onChange={(v) => setProfile({ ...profile, full_name: v })}
              placeholder="Your full legal name"
              required
              readOnly={mode === "view"}
            />
            <Field
              label="Mobile number *"
              value={profile.phone}
              onChange={(v) => setProfile({ ...profile, phone: v })}
              placeholder="+91 9xxxxxxxxx"
              required
              readOnly={mode === "view"}
              error={profile.phone && !isPhone(profile.phone) ? "Enter a valid phone number" : ""}
            />
            <Field
              label="Email *"
              value={profile.email}
              onChange={(v) => setProfile({ ...profile, email: v })}
              placeholder="you@example.com"
              required
              readOnly={mode === "view"}
              error={profile.email && !isEmail(profile.email) ? "Enter a valid email" : ""}
            />
          </CardSection>

          <CardSection
            emoji="🪪"
            title="KYC details"
            blurb="Required for smooth and fast check-in."
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Select
                label="Government ID type *"
                value={profile.govt_id_type}
                onChange={(v) =>
                  setProfile({ ...profile, govt_id_type: v as ProfileRecord["govt_id_type"] })
                }
                options={["Aadhar", "DL", "Passport", "Voter ID"]}
                required
                readOnly={mode === "view"}
              />
              <Field
                label="Government ID number *"
                value={profile.govt_id_number}
                onChange={(v) => setProfile({ ...profile, govt_id_number: v })}
                placeholder="Enter ID number exactly as on document"
                required
                readOnly={mode === "view"}
              />
            </div>
            <TextArea
              label="Residential address"
              value={profile.address}
              onChange={(v) => setProfile({ ...profile, address: v })}
              placeholder="House / Street, Area, City, State, PIN"
              readOnly={mode === "view"}
            />
          </CardSection>

          <CardSection
            emoji="🧰"
            title="Other"
            blurb="Who should we call in case of an emergency?"
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label="Emergency contact person"
                value={profile.emergency_name}
                onChange={(v) => setProfile({ ...profile, emergency_name: v })}
                placeholder="Name"
                readOnly={mode === "view"}
              />
              <Field
                label="Emergency contact number"
                value={profile.emergency_phone}
                onChange={(v) => setProfile({ ...profile, emergency_phone: v })}
                placeholder="+91 …"
                readOnly={mode === "view"}
                error={
                  profile.emergency_phone && !isPhone(profile.emergency_phone)
                    ? "Enter a valid phone number"
                    : ""
                }
              />
            </div>
            <Field
              label="Vehicle number"
              value={profile.vehicle_number}
              onChange={(v) => setProfile({ ...profile, vehicle_number: v.toUpperCase() })}
              placeholder="e.g., DL01AB1234"
              readOnly={mode === "view"}
            />
          </CardSection>

          <CardSection
            emoji="✍️"
            title="Signature / Consent"
            blurb="A quick confirmation of our policies."
          >
            <Checkbox
              label={
                <>
                  I agree to the{" "}
                  <a className="underline" href="/about" target="_blank" rel="noreferrer">About</a>,{" "}
                  <a className="underline" href="/terms" target="_blank" rel="noreferrer">Terms</a>{" "}
                  and{" "}
                  <a className="underline" href="/privacy" target="_blank" rel="noreferrer">Policies</a>.
                </>
              }
              checked={!!profile.consent_terms}
              onChange={(v) => setProfile({ ...profile, consent_terms: v })}
              required
              readOnly={mode === "view"}
            />
          </CardSection>

          {error ? <p className="text-sm text-red-600 -mt-2">{error}</p> : null}
        </form>
      </div>
    </main>
  );
}

/** ---------- Small UI helpers ---------- */
function CardSection({
  emoji,
  title,
  blurb,
  children,
}: {
  emoji: string;
  title: string;
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border p-4 bg-white/95 shadow-xs">
      <div className="mb-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <span className="text-lg">{emoji}</span>
          {title}
        </h2>
        {blurb ? <p className="text-xs text-gray-600 mt-1">{blurb}</p> : null}
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  readOnly,
  error,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  readOnly?: boolean;
  error?: string;
}) {
  const id = useMemo(() => label.toLowerCase().replace(/\s+/g, "-"), [label]);
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm">
        {label} {required ? <span className="text-red-600">*</span> : null}
      </label>
      {readOnly ? (
        <div className="rounded-lg border bg-gray-50 px-3 py-2 text-sm">{value || "—"}</div>
      ) : (
        <input
          id={id}
          className={`rounded-lg border px-3 py-2 text-sm outline-none focus:ring
            ${error ? "border-red-500" : "border-gray-300"}`}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          required={required}
        />
      )}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  readOnly,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}) {
  const id = useMemo(() => label.toLowerCase().replace(/\s+/g, "-"), [label]);
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm">{label}</label>
      {readOnly ? (
        <div className="rounded-lg border bg-gray-50 px-3 py-2 text-sm whitespace-pre-wrap">
          {value || "—"}
        </div>
      ) : (
        <textarea
          id={id}
          className="rounded-lg border px-3 py-2 text-sm outline-none focus:ring min-h-[90px]"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  required,
  readOnly,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  options: string[];
  required?: boolean;
  readOnly?: boolean;
}) {
  const id = useMemo(() => label.toLowerCase().replace(/\s+/g, "-"), [label]);
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm">
        {label} {required ? <span className="text-red-600">*</span> : null}
      </label>
      {readOnly ? (
        <div className="rounded-lg border bg-gray-50 px-3 py-2 text-sm">{value || "—"}</div>
      ) : (
        <select
          id={id}
          className="rounded-lg border px-3 py-2 text-sm"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          required={required}
        >
          <option value="">Select</option>
          {options.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
  required,
  readOnly,
}: {
  label: React.ReactNode;
  checked: boolean;
  onChange?: (v: boolean) => void;
  required?: boolean;
  readOnly?: boolean;
}) {
  return (
    <label className="flex items-start gap-3 text-sm">
      {readOnly ? (
        <input type="checkbox" checked={checked} readOnly className="mt-1" />
      ) : (
        <input
          type="checkbox"
          className="mt-1"
          checked={checked}
          onChange={(e) => onChange?.(e.target.checked)}
          required={required}
        />
      )}
      <span>
        {label} {required ? <span className="text-red-600">*</span> : null}
      </span>
    </label>
  );
}
