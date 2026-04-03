// web/src/routes/Profile.tsx

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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

      // DERIVED: If profiles.full_name is empty, use user_metadata.full_name OR local cache
      if ((!rec.full_name || rec.full_name.trim() === '') && user?.user_metadata) {
        const userMetadata = user.user_metadata as Record<string, any>;
        if (userMetadata.full_name) {
          rec.full_name = userMetadata.full_name;
        }
      }

      // DERIVED: If profiles.phone is empty, use user_metadata.phone OR local cache
      if ((!rec.phone || rec.phone.trim() === '') && user?.user_metadata) {
        const userMetadata = user.user_metadata as Record<string, any>;
        if (userMetadata.phone) {
          rec.phone = userMetadata.phone;
        }
      }

      // If still empty, try to get from local cache as fallback
      if ((!rec.full_name || rec.full_name.trim() === '') && local?.full_name) {
        rec.full_name = local.full_name;
      }
      if ((!rec.phone || rec.phone.trim() === '') && local?.phone) {
        rec.phone = local.phone;
      }

      // Derive avatar public URL if we have a path but not a URL
      if (!rec.profile_photo_url && rec.avatar_path) {
        const { data: pub } = supabase.storage.from("avatars").getPublicUrl(rec.avatar_path);
        rec.profile_photo_url = pub?.publicUrl ?? null;
      }

      const merged = mergeProfiles(rec, local);
      safeWriteLocal(merged);
      return { data: merged, source: "db" };
    }

    // No row yet — prefill from auth, local cache, or user_metadata
    const base: ProfileRecord = {
      ...EMPTY,
      email: user.email ?? "",
      full_name: (user.user_metadata?.full_name as string) ?? (local?.full_name ?? ""),
      phone: (user.user_metadata?.phone as string) ?? (local?.phone ?? ""),
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

    if (error) {
      throw error;
    }

    safeWriteLocal(next);
    return "db";
  } catch (err) {
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
  const navigate = useNavigate();
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
      <main className="min-h-screen bg-[#0a0a0c] text-[#f5f3ef] font-['Inter',sans-serif] grid place-items-center">
        <Spinner label="Loading your profile…" />
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white/90 font-['Inter',sans-serif] selection:bg-[#C5A065]/30">
      <main className="max-w-3xl mx-auto p-6 relative z-10 pt-10">
        <BackHome />

        <header className="flex items-start justify-between gap-4 mt-6">
          <div>
            <h1 className="gn-serif text-3xl font-bold tracking-tight text-white mb-2">Your profile</h1>
            <p className="text-sm text-white/60 mt-1">
              Keep these handy — they speed up check-in and help us reach you in a pinch.
            </p>
            {/* Friendly helper nudges */}
            <p className="text-xs text-[#C5A065] mt-2">
              <strong>Tip:</strong> Add a <em>profile photo</em> so hotel staff
              can greet you faster, and upload your <em>KYC</em> once to breeze
              through future stays.
            </p>
          </div>

          {/* Back to dashboard on view mode */}
          {mode === "view" ? (
            <button onClick={() => navigate(-1)} className="bg-white/5 hover:bg-white/10 border border-white/10 text-white px-4 py-2 rounded-lg text-sm transition-colors whitespace-nowrap">
              Back to dashboard
            </button>
          ) : null}
        </header>

        {/* Completeness indicator */}
        <div className="mt-8 rounded-2xl border border-white/10 bg-[#141210] p-4 shadow-xl">
          <div className="flex items-center justify-between text-sm mb-3">
            <span className="text-white/80 font-medium">Profile completeness</span>
            <span className="font-bold text-[#C5A065]">{score}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#8E713C] to-[#C5A065] transition-all duration-1000"
              style={{ width: `${score}%` }}
            />
          </div>
        </div>

        {/* success banner */}
        {savedOnce && mode === "view" && (
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm flex items-center justify-between shadow-lg shadow-emerald-500/5">
            <span className="text-emerald-400">✅ Profile updated successfully.</span>
            <div className="flex gap-2">
              <button onClick={() => navigate(-1)} className="bg-white/5 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 px-3 py-1.5 rounded-lg text-xs transition-colors">
                Back to dashboard
              </button>
              <button
                className="bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 px-3 py-1.5 rounded-lg text-xs transition-colors"
                onClick={() => setSavedOnce(false)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 rounded-3xl border border-white/10 bg-[#141210] shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-white/5 bg-white/[0.02]">
            <div className="text-xs text-white/50">
              Saved in{" "}
              <span className="font-medium text-white/80">
                {source === "db" ? "Cloud (Supabase)" : "This device"}
              </span>
            </div>
            {mode === "view" ? (
              <button
                className="bg-white/5 hover:bg-white/10 border border-white/10 text-white px-5 py-2 rounded-lg text-sm transition-colors"
                onClick={() => setMode("edit")}
              >
                Edit Profile
              </button>
            ) : (
              <div className="flex gap-3">
                <button
                  className="bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 px-4 py-2 rounded-lg text-sm transition-colors"
                  onClick={() => setMode("view")}
                >
                  Cancel
                </button>
                <button
                  className="bg-gradient-to-r from-[#8E713C] to-[#C5A065] text-white px-5 py-2 rounded-lg text-sm font-medium shadow-lg shadow-[#C5A065]/20 hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleSave}
                  disabled={saving || !requiredOk}
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            )}
          </div>

        {/* Friendly, sectioned form */}
        <form className="p-6 grid gap-6">
          <CardSection
            emoji="🧑‍💼"
            title="User profile"
            blurb="Your public face for reservations — add a photo so staff can recognise you quickly."
          >
            {/* Avatar + basic info */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-6 mb-2">
              <div className="w-20 h-20 rounded-full overflow-hidden border border-white/10 bg-black/50 shadow-inner flex-shrink-0 relative group">
                {profile.profile_photo_url ? (
                  <img
                    src={profile.profile_photo_url}
                    alt="Profile"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-white/30 text-xs">
                    No photo
                  </div>
                )}
                {/* Subtle inner ring overlay */}
                <div className="absolute inset-0 rounded-full border border-white/5 pointer-events-none"></div>
              </div>

              {mode === "edit" && (
                <div className="flex flex-col gap-2">
                  <label className="text-sm text-white/70 font-medium">
                    Profile photo (PNG/JPG, max 3 MB)
                  </label>
                  <label className="bg-white/5 hover:bg-[#C5A065]/20 border border-white/10 hover:border-[#C5A065]/30 text-white/90 px-4 py-2 rounded-lg text-sm transition-all cursor-pointer inline-flex items-center w-max gap-2 group">
                    <svg className="w-4 h-4 text-[#C5A065] group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                    <span>Choose file</span>
                    <input
                      type="file"
                      className="hidden"
                      accept=".png,.jpg,.jpeg,.webp"
                      onChange={handleAvatarFile}
                      disabled={avatarUploading || avatarRemoving}
                    />
                  </label>
                  {avatarUploading ? (
                    <p className="text-xs text-[#C5A065] animate-pulse">Uploading…</p>
                  ) : null}
                  {avatarRemoving ? (
                    <p className="text-xs text-white/50">Removing…</p>
                  ) : null}
                  {avatarError ? (
                    <p className="text-xs text-red-500/90">{avatarError}</p>
                  ) : null}
                  {(profile.avatar_path || profile.profile_photo_url) && !avatarUploading && (
                    <button
                      type="button"
                      className="text-xs text-red-400 hover:text-red-300 underline self-start transition-colors"
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
            <div className="grid gap-4 md:grid-cols-2">
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
                placeholder="Enter exactly as on document"
                required
                readOnly={mode === "view"}
                error={govtIdError}
              />
            </div>

            {/* KYC upload / view (≤3 MB) */}
            {mode === "view" ? (
              <div className="grid gap-1.5">
                <label className="text-sm text-white/70 font-medium">KYC attachment</label>
                {profile.kyc_path ? (
                  kycSignedUrl ? (
                    <a
                      className="inline-flex items-center gap-2 text-[#C5A065] hover:text-[#e0bb7d] text-sm font-medium transition-colors"
                      href={kycSignedUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      View Document (secure link)
                    </a>
                  ) : (
                    <span className="text-sm text-white/40">
                      Generating secure link…
                    </span>
                  )
                ) : (
                  <div className="rounded-xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-white/50">
                    No document uploaded
                  </div>
                )}
              </div>
            ) : (
              <div className="grid gap-2">
                <label className="text-sm text-white/70 font-medium">
                  KYC attachment (PNG/JPG/PDF, max 3 MB)
                </label>
                <div className="flex flex-col items-start gap-2">
                  <label className="bg-white/5 hover:bg-[#C5A065]/20 border border-white/10 hover:border-[#C5A065]/30 text-white/90 px-4 py-2 rounded-lg text-sm transition-all cursor-pointer inline-flex items-center gap-2 group">
                    <svg className="w-4 h-4 text-[#C5A065] group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    <span>Upload Document</span>
                    <input
                      type="file"
                      className="hidden"
                      accept=".png,.jpg,.jpeg,.webp,.pdf"
                      onChange={handleKycFile}
                      disabled={kycUploading}
                    />
                  </label>
                  {kycUploading ? (
                    <p className="text-xs text-[#C5A065] animate-pulse">Uploading…</p>
                  ) : null}
                  {kycError ? (
                    <p className="text-xs text-red-500/90">{kycError}</p>
                  ) : null}
                  {profile.kyc_path && !kycUploading ? (
                    <p className="text-xs text-emerald-400/80">
                      ✅ Document on file. Upload a new one to replace it.
                    </p>
                  ) : null}
                </div>
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
            <div className="grid gap-4 md:grid-cols-2">
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
                    className="text-[#C5A065] hover:text-[#e0bb7d] underline underline-offset-2"
                    href="/about"
                    target="_blank"
                    rel="noreferrer"
                  >
                    About
                  </a>
                  ,{" "}
                  <a
                    className="text-[#C5A065] hover:text-[#e0bb7d] underline underline-offset-2"
                    href="/terms"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Terms
                  </a>{" "}
                  and{" "}
                  <a
                    className="text-[#C5A065] hover:text-[#e0bb7d] underline underline-offset-2"
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
            <p className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 p-3 rounded-lg -mt-2">{error}</p>
          ) : null}
        </form>
        </div> {/* closes the outer rounded-3xl container */}

        {/* Help box */}
        <div className="mt-6 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-5 text-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
          <div className="max-w-[80%] text-white/80 leading-relaxed font-sans cursor-default">
            Having trouble with your profile? No worries — our team can help fix
            it quickly.
          </div>
          <div className="flex gap-3 w-full sm:w-auto">
            <Link to="/contact" className="flex-1 sm:flex-none text-center bg-white/5 hover:bg-white/10 border border-white/10 text-white px-4 py-2 rounded-lg text-sm transition-colors cursor-pointer">
              Contact us
            </Link>
            <a
              className="flex-1 sm:flex-none text-center bg-white/5 hover:bg-white/10 border border-white/10 text-white px-4 py-2 rounded-lg text-sm transition-colors cursor-pointer"
              href="mailto:support@vaiyu.co.in?subject=Profile%20help"
            >
              Email support
            </a>
          </div>
        </div>
      </main>
    </div>
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
    <section className="rounded-2xl border border-white/10 p-6 bg-[#141210] shadow-xl relative overflow-hidden group">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2 text-white/90 tracking-wide">
          <span className="text-xl">{emoji}</span>
          {title}
        </h2>
        {blurb ? (
          <p className="text-sm text-white/50 mt-1.5">{blurb}</p>
        ) : null}
      </div>
      <div className="grid gap-4">{children}</div>
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
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm text-white/70 font-medium tracking-wide">
        {label} {required ? <span className="text-[#C5A065]">*</span> : null}
      </label>
      {readOnly ? (
        <div className="rounded-xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-white/80 cursor-default">
          {value || "—"}
        </div>
      ) : (
        <input
          id={id}
          className={`rounded-xl border px-4 py-3 text-sm outline-none bg-black/40 text-white placeholder-white/30 focus:border-[#C5A065] focus:ring-1 focus:ring-[#C5A065]/50 transition-all ${error ? "border-red-500/50 focus:border-red-500/80" : "border-white/10 hover:border-white/20"
            }`}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          required={required}
        />
      )}
      {error ? <p className="text-xs text-red-500/90">{error}</p> : null}
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
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm text-white/70 font-medium tracking-wide">
        {label}
      </label>
      {readOnly ? (
        <div className="rounded-xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-white/80 whitespace-pre-wrap cursor-default">
          {value || "—"}
        </div>
      ) : (
        <textarea
          id={id}
          className="rounded-xl border px-4 py-3 text-sm outline-none bg-black/40 text-white placeholder-white/30 focus:border-[#C5A065] focus:ring-1 focus:ring-[#C5A065]/50 transition-all border-white/10 hover:border-white/20 min-h-[90px]"
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
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm text-white/70 font-medium tracking-wide">
        {label} {required ? <span className="text-[#C5A065]">*</span> : null}
      </label>
      {readOnly ? (
        <div className="rounded-xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-white/80 cursor-default">
          {value || "—"}
        </div>
      ) : (
        <select
          id={id}
          className="rounded-xl border px-4 py-3 text-sm outline-none bg-black/40 text-white placeholder-white/30 focus:border-[#C5A065] focus:ring-1 focus:ring-[#C5A065]/50 transition-all border-white/10 hover:border-white/20 appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M5%208l5%205%205-5%22%20stroke%3D%22%23ffffff%22%20stroke-width%3D%221.5%22%20fill%3D%22none%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[position:right_1rem_center]"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          required={required}
        >
          <option value="" className="bg-[#1a1a1a] text-white">Select</option>
          {options.map((op) => (
            <option key={op} value={op} className="bg-[#1a1a1a] text-white">
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
    <label className="flex items-start gap-4 text-sm mt-2 group leading-relaxed">
      {readOnly ? (
        <input
          type="checkbox"
          checked={checked}
          readOnly
          className="mt-1 appearance-none w-5 h-5 border border-white/20 rounded bg-white/5 checked:bg-[#C5A065] checked:border-[#C5A065] cursor-default bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%231a1510%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M16.707%205.293a1%201%200%20010%201.414l-8%208a1%201%200%2001-1.414%200l-4-4a1%201%200%20011.414-1.414L8%2012.586l7.293-7.293a1%201%200%20011.414%200z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] checked:bg-center bg-no-repeat bg-[length:0%] checked:bg-[length:100%]"
        />
      ) : (
        <input
          type="checkbox"
          className="mt-1 appearance-none w-5 h-5 flex-shrink-0 border border-white/20 rounded bg-black/40 checked:bg-[#C5A065] checked:border-[#C5A065] cursor-pointer transition-colors group-hover:border-[#C5A065]/50 bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22%231a1510%22%3E%3Cpath%20fill-rule%3D%22evenodd%22%20d%3D%22M16.707%205.293a1%201%200%20010%201.414l-8%208a1%201%200%2001-1.414%200l-4-4a1%201%200%20011.414-1.414L8%2012.586l7.293-7.293a1%201%200%20011.414%200z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E')] checked:bg-center bg-no-repeat bg-[length:0%] checked:bg-[length:100%]"
          checked={checked}
          onChange={(e) => onChange?.(e.target.checked)}
          required={required}
        />
      )}
      <span className="text-white/80 group-hover:text-white/90 transition-colors">
        {label} {required ? <span className="text-[#C5A065]">*</span> : null}
      </span>
    </label>
  );
}
