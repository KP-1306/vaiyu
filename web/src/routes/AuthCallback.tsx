// web/src/routes/AuthCallback.tsx
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function AuthCallback() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();

  useEffect(() => {
    (async () => {
      try {
        // Handles both hash-style tokens (#access_token=...) and ?code=... PKCE links
        await supabase.auth.getSessionFromUrl({ storeSession: true }).catch(async () => {
          // If there is a code param (PKCE), exchange it for a session
          const code = sp.get("code");
          if (code) await supabase.auth.exchangeCodeForSession(code);
        });
      } catch {
        // ignore – we'll just send the user back to signin if needed
      } finally {
        const dest = sp.get("redirect") || "/";
        navigate(dest, { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen grid place-items-center">
      <div className="text-sm text-gray-600">Signing you in…</div>
    </div>
  );
}
