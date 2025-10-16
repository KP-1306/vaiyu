// web/src/routes/SignIn.tsx
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

function maskEmail(e: string) {
  const [user, domain = ""] = e.split("@");
  if (!user || !domain) return e;
  const u = user.length <= 2 ? user[0] ?? "" : `${user[0]}${"*".repeat(Math.max(1, user.length - 2))}${user.at(-1)}`;
  return `${u}@${domain}`;
}

const ORIGIN =
  (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, "") ||
  (typeof window !== "undefined" ? window.location.origin : "");

export default function SignIn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const intent = params.get("intent");         // "signup" | "signin" | null
  const redirect = params.get("redirect") || ""; // where to go after login
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 🚦 If already signed in, skip this page
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        // get role and route (mirrors AuthCallback)
        let dest = redirect || "/guest";
        const { data: u } = await supabase.auth.getUser();
        if (u?.user) {
          const { data: profile } = await supabase
            .from("user_profiles")
            .select("role, home_path")
            .eq("user_id", u.user.id)
            .maybeSingle();
          if (!redirect) {
            const role = profile?.role;
            if (role === "owner" || role === "manager") dest = "/owner";
            else if (role === "staff") dest = "/desk";
            else dest = "/guest";
            if (profile?.home_path) dest = profile.home_path;
          }
        }
        navigate(dest, { replace: true });
      }
    })();
  }, [navigate, redirect]);

  const heading = intent === "signup" ? "Create your account" : "Sign in to VAiyu";
  const sub = "Enter your work email. We’ll email you a secure magic link — if you’re new, we’ll create your account automatically.";
  const cta = intent === "signup" ? "Email me a sign-up link" : "Send magic link";

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // default to /owner if no redirect was supplied (you can change this)
      const desired = redirect || "/owner";
      const redirectTo = `${ORIGIN}/auth/callback?redirect=${encodeURIComponent(desired)}`;
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setSent(true);
    } catch (err: any) {
      setError(err?.message ?? "Could not send magic link. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-gray-50">
      <div className="w-full max-w-md rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">{heading}</h1>
        <p className="text-sm text-gray-600 mt-1">{sub}</p>

        {sent ? (
          <div className="mt-4 rounded-md bg-sky-50 p-3 text-sky-800 text-sm">
            We’ve sent a magic link to <strong>{maskEmail(email)}</strong>. Open it on this device to finish{" "}
            {intent === "signup" ? "signing up" : "signing in"}.
          </div>
        ) : (
          <form className="mt-4 space-y-3" onSubmit={handleSend}>
            <div>
              <label htmlFor="email" className="block text-sm font-medium">
                Work email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2"
                placeholder="you@hotel.com"
                autoComplete="email"
                disabled={loading}
              />
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}

            <button className="btn w-full" type="submit" disabled={loading}>
              {loading ? "Sending…" : cta}
            </button>
          </form>
        )}

        <div className="mt-6 text-sm text-gray-600 flex items-center justify-between">
          <Link to="/" className="hover:underline">
            ← Back to home
          </Link>
          {!sent &&
            (intent === "signup" ? (
              <Link to="/signin" className="hover:underline">
                Already have an account? Sign in
              </Link>
            ) : (
              <Link to="/signin?intent=signup" className="hover:underline">
                New here? Create an account
              </Link>
            ))}
        </div>

        <div className="mt-3 text-xs text-gray-500">
          No passwords needed. The link expires in ~10 minutes. If you didn’t receive it, check spam or try again.
        </div>
      </div>
    </div>
  );
}
