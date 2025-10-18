// web/src/components/LogoutButton.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

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
      await supabase.auth.signOut();
    } catch {
      // ignore – even if signOut throws, kick them to public home
    } finally {
      // ✅ public home after logout
      navigate("/", { replace: true });
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
