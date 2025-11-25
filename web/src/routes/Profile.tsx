// web/src/routes/Profile.tsx

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Spinner from "../components/Spinner";
import BackHome from "../components/BackHome";

/** ---------- Types ---------- */
type GovtIdType = "Aadhar" | "DL" | "Passport" | "Voter ID" | "";

type ProfileRecord = {
  id?: string; // user id (uuid)
  vaiyu_id?: string | null; // read-only VAiyu ID like V-123456

  // User Profile
  full_name: string;
  phone: string;
  email: string;
  profile_photo_url?: string | null; // public avatar URL (derived from avatar_path)
  avatar_path?: string | null; // storage key for avatar

  // KYC
  govt_id_type: GovtIdType;
  govt_id_number: string;
  address: string;
  govt_id_file_url?: string | null; // (kept for backward compat; may be null going forward)
  kyc_path?: string | null; // storage key for KYC (private bucket)

  // Other
  emergency_name: string;
  emergency_phone: string;
  vehicle_number: string;

  // Consent
  consent_terms: boolean;

  updated_at?: string | null;
};

const EMPTY: ProfileRecord = {
  vaiyu_id: null,
  full_name: "",
  phone: "",
  email: "",
  profile_photo_url: null,
  avatar_path: null,
  govt_id_type: "",
  govt_id_number: "",
  address: "",
  govt_id_file_url: null,
  kyc_path: null,
  emergency_name: "",
  emergency_phone: "",
  vehicle_number: "",
  consent_terms: false,
};

/** LocalStorage safety fallback key */
const LS_KEY = "va:profile";

/** Utility: phone & email checks (slightly stricter) */
const isPhone = (s: string) => {
  const trimmed = s.trim();
  const digits = trimmed.replace(/\D+/g, "");
  if (digits.length < 8 || digits.length > 15) return false;
  return /^[0-9+\-\s]+$/.test(trimmed);
};
const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

/** Basic full-name sanity check */
const isFullName = (s: string) => {
  const v = s.trim();
  if (v.length < 3) return false;
  // At least two letters somewhere; allow spaces and dots.
  return /[A-Za-z]{2,}/.test(v);
};

/** Govt ID format checks per type (very India-oriented, but forgiving) */
function validateGovtId(type: GovtIdType, raw: string): string {
  const v = raw.trim().toUpperCase();
  if (!type || !v) return "";
  const digits = v.replace(/\D+/g, "");

  switch (type) {
    case "Aadhar": {
      // 12 digits, starting 2–9
      if (!/^[2-9]\d{11}$/.test(digits)) {
        return "Aadhar should be a 12-digit number starting from 2–9.";
      }
      return "";
    }
    case "Passport": {
      // Common Indian passport pattern: 1 letter + 7 digits
      if (!/^[A-PR-WY][1-9][0-9]{6}$/.test(v)) {
        return "Passport should look like N1234567 (1 letter + 7 digits).";
      }
      return "";
    }
    case "Voter ID": {
      // 3 letters + 7 digits (EPIC)
      if (!/^[A-Z]{3}[0-9]{7}$/.test(v)) {
        return "Voter ID should be 3 letters followed by 7 digits.";
      }
      return "";
    }
    case "DL": {
      // Rough DL pattern: 2 letters (state) + 2 digits (RTO) + 4–11 alnum
      if (!/^[A-Z]{2}[0-9]{2}[0-9A-Z]{4,11}$/.test(v)) {
        return "DL should look like DL01YYYY… (2 letters, 2 digits, then 4–11 letters/digits).";
      }
      return "";
    }
    default:
      return "";
  }
}

/** Completeness score (0–100) — just a nudge, not blocking */
function completeness(p: ProfileRecord) {
  let got = 0;
  const needs: Array<boolean> = [
    !!p.full_name.trim(),
    isPhone(p.phone),
    isEmail(p.email),
    !!p.govt_id_type,
    !!p.govt_id_number.trim(),
    !!(p.profile_photo_url || p.avatar_path),
    !!(p.govt_id_file_url || p.kyc_path),
    !!p.consent_terms,
  ];
  needs.forEach((b) => (got += b ? 1 : 0));
  return Math.round((got / needs.length) * 100);
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
  } catch {
    // ignore
  }
}

/** Merge DB row with local cached profile.
 *  Local non-empty fields always win, so a failed DB upsert
 *  can’t wipe a newer local profile on reload.
 */
function mergeProfiles(dbRec: ProfileRecord, local: ProfileRecord | null): ProfileRecord {
  if (!local) return dbRec;
  const out: ProfileRecord = { ...dbRec };
  (Object.keys(local) as (keyof ProfileRecord)[]).forEach((key) => {
    const val = local[key];
    if (val == null) return;
    if (typeof val === "string" && val.trim() === "") return;
    if (typeof val === "boolean" && val === false && (dbRec as any)[key] === true) {
      // don't force false over true unless user really changed it – but
      // for now, keep DB "true" if local is false and DB is true
      return;
    }
    out[key] = val as any;
  });
  return out;
}

/** ---------- DB <-> UI normalization ---------- */
function normalizeFromDb(row: any): ProfileRecord {
  return {
    id: row.id,
    vaiyu_id: row.vaiyu_id ?? null,
    full_name: row.full_name ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    profile_photo_url: row.profile_photo_url ?? null,
    avatar_path: row.avatar_path ?? null,
    govt_id_type: row.govt_id_type ?? "",
    govt_id_number: row.govt_id_number ?? "",
    address: row.address ?? "",
    govt_id_file_url: row.govt_id_file_url ?? null,
    kyc_path: row.kyc_path ?? null,
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
    vaiyu_id: p.vaiyu_id ?? null,
    full_name: p.full_name || null,
    phone: p.phone || null,
    email: p.email || null,
    profile_photo_url: p.profile_photo_url || null,
    avatar_path: p.avatar_path || null,
    govt_id_type: p.govt_id_type || null,
    govt_id_number: p.govt_id_number || null,
    address: p.address || null,
    govt_id_file_url: p.govt_id_file_url || null,
    kyc_path: p.kyc_path || null,
    emergency_name: p.emergency_name || null,
    emergency_phone: p.emergency_phone || null,
    vehicle_number: p.vehicle_number || null,
    consent_terms: !!p.consent_terms,
    updated_at: new Date().toISOString(),
  };
}

/** Save + load with graceful Supabase + local fallback */
async function loadProfile(): Promise<{ data: ProfileRecord; source: "db" | "local" }> {
  const { data: sess } = await supabase
    .auth
    .getSession()
    .catch(() => ({ data: { session: null } as any }));

  const user = sess?.session?.user;
  const local = safeReadLocal();

  if (!user) {
    return { data: local ?? { ...EMPTY, email: "" }, source: "local" };
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

      // Derive avatar public URL if we have a path but not a URL
      if (!rec.profile_photo_url && rec.avatar_path) {
        const { data: pub } = supabase.storage.from("avatars").getPublicUrl(rec.avatar_path);
        rec.profile_photo_url = pub?.publicUrl ?? null;
      }

      const merged = mergeProfiles(rec, local);
      safeWriteLocal(merged);
      return { data: merged, source: "db" };
    }

    // No row yet — prefill from auth & merge with any local cache
    const base: ProfileRecord = {
      ...EMPTY,
      email: user.email ?? "",
      full_name: user.user_metadata?.full_name ?? "",
      phone: user.user_metadata?.phone ?? "",
    };
    const merged = mergeProfiles(base, local);
    safeWriteLocal(merged);
    return { data: merged, source: local ? "local" : "db" };
  } catch {
    return { data: local ?? { ...EMPTY, email: user?.email ?? "" }, source: "local" };
  }
}

async function saveProfile(next: ProfileRecord): Promise<"db" | "local"> {
  const { data: sess } = await supabase
    .auth
    .getSession()
    .catch(() => ({ data: { session: null } as any }));

  const user = sess?.session?.user;

  if (!user) {
    safeWriteLocal(next);
    return "local";
  }

  try {
    const payload = normalizeToDb(user.id, next);
    const { error } = await supabase
      .from("profiles")
      .upsert(payload, { onConflict: "id" });
    if (error) throw error;
    safeWriteLocal(next);
    return "db";
  } catch {
    // If DB write fails for any reason (missing columns / RLS),
    // keep at least the local copy so the user doesn't lose data.
    safeWriteLocal(next);
    return "local";
  }
}

/** ---------- Small helpers ---------- */
// Upload to a bucket; optionally delete previous path; optionally downscale (images only)
async function uploadToBucket({
  bucket,
  file,
  userId,
  prevPath,
  downscaleMax,
}: {
  bucket: "avatars" | "kyc";
  file: File;
  userId: string;
  prevPath?: string | null;
  downscaleMax?: number; // px
}): Promise<{ path: string; publicUrl?: string }> {
  let uploadFile: File | Blob = file;

  if (downscaleMax && file.type.startsWith("image/")) {
    try {
      uploadFile = await downscaleImage(file, downscaleMax);
    } catch {
      // ignore — fallback to original file
    }
  }

  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${userId}/${Date.now()}-${safeName}`;

  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(path, uploadFile, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type,
    });
  if (upErr) throw upErr;

  // best-effort: delete old object after successful upload
  if (prevPath) {
    try {
      await supabase.storage.from(bucket).remove([prevPath]);
    } catch {
      // ignore
    }
  }

  const out: { path: string; publicUrl?: string } = { path };
  if (bucket === "avatars") {
    const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
    out.publicUrl = pub?.publicUrl ?? undefined;
  }
  return out;
}

function downscaleImage(file: File, max = 1024): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      if (scale >= 1) {
        URL.revokeObjectURL(url);
        resolve(file);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        return reject(new Error("Canvas not supported"));
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob);
          else reject(new Error("Could not create blob"));
        },
        file.type === "image/webp" ? "image/webp" : "image/jpeg",
        0.9,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Invalid image"));
    };
    img.src = url;
  });
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

  // Upload states
  const [kycUploading, setKycUploading] = useState(false);
  const [kycError, setKycError] = useState<string | null>(null);
  const [kycSignedUrl, setKycSignedUrl] = useState<string | null>(null);

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarRemoving, setAvatarRemoving] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const res = await loadProfile();
      if (!mounted) return;
      setProfile(res.data);
      setSource(res.source);
      setMode(
        res.data.full_name || res.data.phone || res.data.govt_id_type
          ? "view"
          : "edit",
      );
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // refresh signed KYC URL whenever path changes (TTL ~60s)
  useEffect(() => {
    (async () => {
      if (!profile.kyc_path) {
        setKycSignedUrl(null);
        return;
      }
      try {
        const { data, error } = await supabase
          .storage
          .from("kyc")
          .createSignedUrl(profile.kyc_path, 60);
        if (error) throw error;
        setKycSignedUrl(data?.signedUrl ?? null);
      } catch {
        setKycSignedUrl(null);
      }
    })();
  }, [profile.kyc_path]);

  // ✅ Consent becomes immutable once accepted and saved to DB (or after first successful save).
  const consentLocked = useMemo(
    () => !!profile.consent_terms && (source === "db" || savedOnce),
    [profile.consent_terms, source, savedOnce],
  );

  const govtIdError = useMemo(
    () => validateGovtId(profile.govt_id_type, profile.govt_id_number),
    [profile.govt_id_type, profile.govt_id_number],
  );

  const requiredOk = useMemo(() => {
    if (!isFullName(profile.full_name)) return false;
    if (!isPhone(profile.phone)) return false;
    if (!isEmail(profile.email)) return false;
    if (!profile.govt_id_type) return false;
    if (!profile.govt_id_number.trim()) return false;
    if (govtIdError) return false;
    if (!profile.consent_terms) return false;
    return true;
  }, [profile, govtIdError]);

  const score = completeness(profile);

  async function handleSave(e?: React.SyntheticEvent) {
    e?.preventDefault();
    setError(null);
    if (!requiredOk) {
      setError(
        "Please complete all required fields marked with * and fix validation errors.",
      );
      return;
    }
    setSaving(true);
    const where = await saveProfile(profile);
    setSaving(false);
    setSource(where);
    setMode("view");
    setSavedOnce(true); // lock consent within this session after a successful save
  }

  /** ---------- Upload handlers ---------- */

  // KYC (PDF or Image) — 3 MB with delete-on-replace + signed delivery
  async function handleKycFile(e: React.ChangeEvent<HTMLInputElement>) {
    setKycError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const allowed = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
    if (!allowed.includes(file.type)) {
      setKycError("Please upload a PNG, JPG, WEBP, or PDF file.");
      e.currentTarget.value = "";
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setKycError("File is too large. Max 3 MB.");
      e.currentTarget.value = "";
      return;
    }

    setKycUploading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess?.session?.user?.id;
      if (!uid) throw new Error("You must be signed in to upload.");

      const up = await uploadToBucket({
        bucket: "kyc",
        file,
        userId: uid,
        prevPath: profile.kyc_path || undefined,
      });

      setProfile((p) => ({
        ...p,
        kyc_path: up.path,
        govt_id_file_url: null,
      })); // url no longer public
    } catch (err: any) {
      setKycError(err?.message ?? "Upload failed. Please try again.");
    } finally {
      setKycUploading(false);
    }
  }

  // Avatar (Image only) — 3 MB  ✅ downscale + delete-on-replace
  async function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    setAvatarError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const allowed = /^image\/(png|jpe?g|webp)$/i;
    if (!allowed.test(file.type)) {
      setAvatarError("Please upload a PNG, JPG, or WEBP image.");
      e.currentTarget.value = "";
      return;
    }

    setAvatarUploading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess?.session?.user?.id;
      if (!uid) throw new Error("You must be signed in to upload.");

      const up = await uploadToBucket({
        bucket: "avatars",
        file,
        userId: uid,
        prevPath: profile.avatar_path || undefined,
        downscaleMax: 1024,
      });

      setProfile((p) => ({
        ...p,
        avatar_path: up.path,
        profile_photo_url: up.publicUrl ?? p.profile_photo_url,
      }));
    } catch (err: any) {
      setAvatarError(err?.message ?? "Upload failed. Please try again.");
    } finally {
      setAvatarUploading(false);
    }
  }

  // Remove avatar and clear state (also deletes from Storage)
  async function handleRemoveAvatar() {
    if (!profile.avatar_path) {
      setProfile((p) => ({ ...p, profile_photo_url: null }));
      return;
    }
    setAvatarError(null);
    setAvatarRemoving(true);
    try {
      const { error } = await supabase.storage
        .from("avatars")
        .remove([profile.avatar_path]);
      if (error) throw error;
      setProfile((p) => ({
        ...p,
        avatar_path: null,
        profile_photo_url: null,
      }));
    } catch (err: any) {
      setAvatarError(
        err?.message ?? "Could not remove photo. Please try again.",
      );
    } finally {
      setAvatarRemoving(false);
    }
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
            Keep these handy — they speed up check-in and help us reach you in a
            pinch.
          </p>
          {/* Friendly helper nudges */}
          <p className="text-xs text-gray-600 mt-2">
            <strong>Tip:</strong> Add a <em>profile photo</em> so hotel staff
            can greet you faster, and upload your <em>KYC</em> once to breeze
            through future stays.
          </p>
        </div>

        {/* Back to dashboard on view mode */}
        {mode === "view" ? (
          <Link to="/guest" className="btn btn-light whitespace-nowrap">
            Back to dashboard
          </Link>
        ) : null}
      </header>

      {/* Completeness indicator */}
      <div className="mt-4 rounded-xl border bg-white/90 shadow-sm p-3">
        <div className="flex items-center justify-between text-sm">
          <span>Profile completeness</span>
          <span className="font-medium">{score}%</span>
        </div>
        <div className="mt-2 h-2 rounded bg-gray-200 overflow-hidden">
          <div
            className="h-full bg-blue-600"
            style={{ width: `${score}%` }}
          />
        </div>
      </div>

      {/* success banner */}
      {savedOnce && mode === "view" && (
        <div className="mt-4 rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm flex items-center justify-between">
          <span>✅ Profile updated successfully.</span>
          <div className="flex gap-2">
            <Link to="/guest" className="btn btn-light">
              Back to dashboard
            </Link>
            <button
              className="btn btn-light"
              onClick={() => setSavedOnce(false)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-2xl border bg-white/90 shadow-sm">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="text-xs text-gray-600">
            Saved in{" "}
            <span className="font-medium">
              {source === "db" ? "Cloud (Supabase)" : "This device"}
            </span>
          </div>
          {mode === "view" ? (
            <button
              className="btn btn-light"
              onClick={() => setMode("edit")}
            >
              Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                className="btn btn-light"
                onClick={() => setMode("view")}
              >
                Cancel
              </button>
              <button
                className="btn"
                onClick={handleSave}
                disabled={saving || !requiredOk}
              >
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
            blurb="Your public face for reservations — add a photo so staff can recognise you quickly."
          >
            {/* Avatar + basic info */}
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full overflow-hidden border bg-gray-100">
                {profile.profile_photo_url ? (
                  <img
                    src={profile.profile_photo_url}
                    alt="Profile"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-gray-400 text-xs">
                    No photo
                  </div>
                )}
              </div>

              {mode === "edit" && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-600">
                    Profile photo (PNG/JPG/WEBP, max 3 MB)
                  </label>
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp"
                    onChange={handleAvatarFile}
                    disabled={avatarUploading || avatarRemoving}
                  />
                  {avatarUploading ? (
                    <p className="text-xs text-gray-600">Uploading…</p>
                  ) : null}
                  {avatarRemoving ? (
                    <p className="text-xs text-gray-600">Removing…</p>
                  ) : null}
                  {avatarError ? (
                    <p className="text-xs text-red-600">{avatarError}</p>
                  ) : null}
                  {(profile.avatar_path || profile.profile_photo_url) && (
                    <button
                      type="button"
                      className="text-xs underline self-start"
                      onClick={handleRemoveAvatar}
                      disabled={avatarRemoving}
                    >
                      Remove photo
                    </button>
                  )}
                </div>
              )}
            </div>

            <Field label="VAiyu ID" value={profile.vaiyu_id || ""} readOnly />
            <Field
              label="Full name *"
              value={profile.full_name}
              onChange={(v) => setProfile({ ...profile, full_name: v })}
              placeholder="Your full legal name"
              required
              readOnly={mode === "view"}
              error={
                profile.full_name && !isFullName(profile.full_name)
                  ? "Enter your full legal name."
                  : ""
              }
            />
            <Field
              label="Mobile number *"
              value={profile.phone}
              onChange={(v) => setProfile({ ...profile, phone: v })}
              placeholder="+91 9xxxxxxxxx"
              required
              readOnly={mode === "view"}
              error={
                profile.phone && !isPhone(profile.phone)
                  ? "Enter a valid phone number (8–15 digits)."
                  : ""
              }
            />
            <Field
              label="Email *"
              value={profile.email}
              onChange={(v) => setProfile({ ...profile, email: v })}
              placeholder="you@example.com"
              required
              readOnly={mode === "view"}
              error={
                profile.email && !isEmail(profile.email)
                  ? "Enter a valid email."
                  : ""
              }
            />
          </CardSection>

          <CardSection
            emoji="🪪"
            title="KYC details"
            blurb="Upload once, and speed through future check-ins."
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Select
                label="Government ID type *"
                value={profile.govt_id_type}
                onChange={(v) =>
                  setProfile({
                    ...profile,
                    govt_id_type: v as ProfileRecord["govt_id_type"],
                  })
                }
                options={["Aadhar", "DL", "Passport", "Voter ID"]}
                required
                readOnly={mode === "view"}
              />
              <Field
                label="Government ID number *"
                value={profile.govt_id_number}
                onChange={(v) =>
                  setProfile({ ...profile, govt_id_number: v.toUpperCase() })
                }
                placeholder="Enter ID number exactly as on document"
                required
                readOnly={mode === "view"}
                error={govtIdError}
              />
            </div>

            {/* KYC upload / view (≤3 MB) */}
            {mode === "view" ? (
              <div className="grid gap-1">
                <label className="text-sm">KYC attachment</label>
                {profile.kyc_path ? (
                  kycSignedUrl ? (
                    <a
                      className="inline-block text-blue-700 underline text-sm"
                      href={kycSignedUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View (secure link)
                    </a>
                  ) : (
                    <span className="text-sm text-gray-600">
                      Generating link…
                    </span>
                  )
                ) : (
                  <div className="rounded-lg border bg-gray-50 px-3 py-2 text-sm">
                    —
                  </div>
                )}
              </div>
            ) : (
              <div className="grid gap-1">
                <label className="text-sm">
                  KYC attachment (PNG/JPG/WEBP/PDF, max 3 MB)
                </label>
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.pdf"
                  onChange={handleKycFile}
                  disabled={kycUploading}
                />
                {kycUploading ? (
                  <p className="text-xs text-gray-600">Uploading…</p>
                ) : null}
                {kycError ? (
                  <p className="text-xs text-red-600">{kycError}</p>
                ) : null}
                {profile.kyc_path ? (
                  <p className="text-xs">
                    A document is on file. Upload again to replace.
                  </p>
                ) : null}
              </div>
            )}

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
                onChange={(v) =>
                  setProfile({ ...profile, emergency_name: v })
                }
                placeholder="Name"
                readOnly={mode === "view"}
              />
              <Field
                label="Emergency contact number"
                value={profile.emergency_phone}
                onChange={(v) =>
                  setProfile({ ...profile, emergency_phone: v })
                }
                placeholder="+91 …"
                readOnly={mode === "view"}
                error={
                  profile.emergency_phone && !isPhone(profile.emergency_phone)
                    ? "Enter a valid phone number."
                    : ""
                }
              />
            </div>
            <Field
              label="Vehicle number"
              value={profile.vehicle_number}
              onChange={(v) =>
                setProfile({ ...profile, vehicle_number: v.toUpperCase() })
              }
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
                  <a
                    className="underline"
                    href="/about"
                    target="_blank"
                    rel="noreferrer"
                  >
                    About
                  </a>
                  ,{" "}
                  <a
                    className="underline"
                    href="/terms"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Terms
                  </a>{" "}
                  and{" "}
                  <a
                    className="underline"
                    href="/privacy"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Policies
                  </a>
                  .
                </>
              }
              checked={!!profile.consent_terms}
              onChange={(v) =>
                setProfile({ ...profile, consent_terms: v })
              }
              required
              readOnly={mode === "view" || consentLocked}
            />
          </CardSection>

          {error ? (
            <p className="text-sm text-red-600 -mt-2">{error}</p>
          ) : null}
        </form>
      </div>

      {/* Help box */}
      <div className="mt-4 rounded-xl border bg-blue-50/70 p-4 text-sm flex items-center justify-between">
        <div className="max-w-[80%]">
          Having trouble with your profile? No worries — our team can help fix
          it quickly.
        </div>
        <div className="flex gap-2">
          <Link to="/contact" className="btn btn-light">
            Contact us
          </Link>
          <a
            className="btn btn-light"
            href="mailto:support@vaiyu.co.in?subject=Profile%20help"
          >
            Email support
          </a>
        </div>
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
        {blurb ? (
          <p className="text-xs text-gray-600 mt-1">{blurb}</p>
        ) : null}
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
  const id = useMemo(
    () => label.toLowerCase().replace(/\s+/g, "-"),
    [label],
  );
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm">
        {label} {required ? <span className="text-red-600">*</span> : null}
      </label>
      {readOnly ? (
        <div className="rounded-lg border bg-gray-50 px-3 py-2 text-sm">
          {value || "—"}
        </div>
      ) : (
        <input
          id={id}
          className={`rounded-lg border px-3 py-2 text-sm outline-none focus:ring ${
            error ? "border-red-500" : "border-gray-300"
          }`}
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
  const id = useMemo(
    () => label.toLowerCase().replace(/\s+/g, "-"),
    [label],
  );
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
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
  const id = useMemo(
    () => label.toLowerCase().replace(/\s+/g, "-"),
    [label],
  );
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm">
        {label} {required ? <span className="text-red-600">*</span> : null}
      </label>
      {readOnly ? (
        <div className="rounded-lg border bg-gray-50 px-3 py-2 text-sm">
          {value || "—"}
        </div>
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
        <input
          type="checkbox"
          checked={checked}
          readOnly
          className="mt-1"
        />
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
