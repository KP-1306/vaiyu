// web/src/components/LogoutButton.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

/**
 * Core sign-out button. Use anywhere you need a "Sign out" CTA.
 */
export default function LogoutButton({
  className = "btn btn-light",
  label = "Sign out",
}: { className?: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function handleSignOut() {
    if (busy) return;
    setBusy(true);
    try {
      // Global: signs out all tabs/sessions
      await supabase.auth.signOut({ scope: "global" });
    } catch {
      /* ignore — still redirect */
    } finally {
      // Extra hygiene: clear any cached keys if you store them
      try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith("sb-") && k.endsWith("-auth-token")) keys.push(k);
        }
        keys.forEach(k => localStorage.removeItem(k));
      } catch {}
      try { localStorage.removeItem("va:guest"); } catch {}
      try { sessionStorage.clear(); } catch {}

      // ✅ New flow: go to public landing page
      window.location.href = "https://vaiyu.co.in";
    }
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={busy}
      className={className}
      aria-busy={busy}
    >
      {busy ? "Signing out…" : label}
    </button>
  );
}

/**
 * Optional wrapper that matches your existing usage:
 * shows (optional) email, a "Home" link, and the sign-out button.
 *
 * Example:
 *   <LogoutRow authed={true} userEmail="user@site.com" />
 */
export function LogoutRow({
  authed,
  userEmail,
}: {
  authed?: boolean;
  userEmail?: string | null;
}) {
  if (!authed) return null;

  return (
    <div className="flex items-center gap-2">
      {/* Optional: show who’s signed in */}
      {userEmail ? (
        <span className="text-sm text-muted-foreground">{userEmail}</span>
      ) : null}

      {/* 🔁 Replaces the old href="/welcome" */}
      <a className="btn btn-light" href="/">Home</a>

      <LogoutButton />
    </div>
  );
}
