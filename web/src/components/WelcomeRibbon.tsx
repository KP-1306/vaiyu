// web/src/components/WelcomeRibbon.tsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

/**
 * Friendly greeting bar that appears under the header when a user is signed in.
 * Dismissal is remembered for the current tab (sessionStorage).
 */
export default function WelcomeRibbon() {
  const [name, setName] = useState<string | null>(null);
  const [hidden, setHidden] = useState<boolean>(() => {
    return sessionStorage.getItem("welcome:dismissed") === "1";
  });

  // Load user once + stay in sync with auth changes
  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const { data } = await supabase.auth.getUser();
      if (!mounted) return;
      const user = data.user;
      if (!user) {
        setName(null);
        return;
      }

      // Prefer a friendly name if available, else email alias
      const fullName =
        (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || "";
      const emailAlias = user.email?.split("@")[0] || "";
      const pretty = (fullName || emailAlias || "").trim();
      setName(pretty || null);
    };

    load();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      const user = session?.user;
      const fullName =
        (user?.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || "";
      const emailAlias = user?.email?.split("@")[0] || "";
      const pretty = (fullName || emailAlias || "").trim();
      setName(pretty || null);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 5) return "You’re up late";
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    if (hour < 22) return "Good evening";
    return "Hello";
  }, []);

  if (!name || hidden) return null;

  return (
    <div className="w-full border-b border-blue-100 bg-blue-50/70 text-blue-900">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2 text-sm">
        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-blue-600 text-white text-xs font-semibold">
          ✨
        </span>
        <div className="flex-1">
          <strong>{greeting}, {name}!</strong>{" "}
          <span className="text-blue-900/80">
            Great to see you — hope your day’s going smoothly.
          </span>
        </div>
        <button
          onClick={() => {
            sessionStorage.setItem("welcome:dismissed", "1");
            setHidden(true);
          }}
          aria-label="Dismiss"
          className="rounded-md px-2 py-1 text-blue-900/70 hover:text-blue-900"
        >
          ×
        </button>
      </div>
    </div>
  );
}
