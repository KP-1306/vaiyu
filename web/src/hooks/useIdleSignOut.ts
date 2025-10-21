import { useEffect } from "react";
import { supabase } from "../lib/supabase";

/**
 * Auto sign-out the user after X minutes of inactivity.
 * Inactivity = no click/scroll/key/move/touch/visibility events.
 */
export function useIdleSignOut({
  maxIdleMinutes = 180,
  onKick = () => window.location.replace("/logout"),
}: {
  maxIdleMinutes?: number;
  onKick?: () => void;
} = {}) {
  useEffect(() => {
    let last = Date.now();

    const bump = () => { last = Date.now(); };
    const events = [
      "click",
      "keydown",
      "mousemove",
      "scroll",
      "touchstart",
      "visibilitychange",
    ] as const;

    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));

    const t = window.setInterval(async () => {
      const idleMs = Date.now() - last;
      if (idleMs > maxIdleMinutes * 60_000) {
        try {
          await supabase.auth.signOut({ scope: "global" });
        } catch {}
        onKick();
      }
    }, 30_000);

    return () => {
      window.clearInterval(t);
      events.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [maxIdleMinutes, onKick]);
}
