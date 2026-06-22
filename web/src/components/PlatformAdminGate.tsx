// web/src/components/PlatformAdminGate.tsx
//
// Route guard for the platform Operator Console. Gates via the CANONICAL
// platform-admin check — public.is_platform_admin() (an active row in
// platform_admins) — NOT AdminGate's profiles.role==='admin', which is a
// different/legacy notion. Fails closed.
import { ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function PlatformAdminGate({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.rpc("is_platform_admin");
      if (alive) setOk(!error && data === true);
    })();
    return () => { alive = false; };
  }, []);

  if (ok === null) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#0B0E14] text-slate-400 text-sm">
        Checking access…
      </div>
    );
  }
  if (!ok) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#0B0E14] text-slate-300">
        <div className="text-center">
          <div className="text-4xl mb-3">🔒</div>
          <div className="text-lg font-semibold text-white mb-1">Platform admins only</div>
          <p className="text-sm text-slate-400 mb-4">You don’t have access to the Operator Console.</p>
          <Link to="/owner" className="inline-flex items-center rounded-lg border border-slate-700 bg-[#151A25] px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 transition-colors">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
