// web/src/components/AccountControls.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

export default function AccountControls() {
  const [email, setEmail] = useState<string | null>(null);

  // Detect where we are
  const isMarketingOnly = useMemo(() => {
    const sp = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const onRoot = typeof window !== "undefined" ? window.location.pathname === "/" : false;
    const appParam = sp.get("app") === "1";
    // Only show on marketing: "/" without ?app=1
    return onRoot && !appParam;
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      if (!mounted) return;
      setEmail(data?.user?.email ?? null);

      const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
        if (!mounted) return;
        setEmail(sess?.user?.email ?? null);
      });
      return () => sub.subscription.unsubscribe();
    })();
    return () => { mounted = false; };
  }, []);

  // If not signed in or not on marketing, hide the pill entirely
  if (!email || !isMarketingOnly) return null;

  async function onSignOut(e: React.FormEvent) {
    e.preventDefault();
    await supabase.auth.signOut();
    location.href = "/"; // back to marketing
  }

  return (
    <div className="fixed top-3 right-3 z-50">
      <div className="rounded-xl border bg-white/90 backdrop-blur px-3 py-2 shadow flex items-center gap-2">
        <span className="text-xs text-gray-600 truncate max-w-[180px]" title={email}>{email}</span>
        <a href="/?app=1" className="btn btn-light btn-xs" aria-label="Open my dashboard">
          Open app
        </a>
        <form onSubmit={onSignOut}>
          <button type="submit" className="btn btn-xs">Sign out</button>
        </form>
      </div>
    </div>
  );
}
