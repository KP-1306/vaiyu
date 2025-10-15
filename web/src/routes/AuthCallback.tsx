// web/src/routes/AuthCallback.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function AuthCallback() {
  const [msg, setMsg] = useState("Finalizing sign-in…");

  useEffect(() => {
    // Supabase auto-handles the hash; we just read the session and route.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setMsg("Signed in. Redirecting…");
        const to = sessionStorage.getItem("postLogin") || "/admin";
        setTimeout(() => (window.location.href = to), 600);
      } else {
        setMsg("No active session. Try signing in again.");
      }
    });
  }, []);

  return (
    <div className="min-h-[40vh] grid place-items-center">
      <div className="text-gray-700">{msg}</div>
    </div>
  );
}
