import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { track } from "../lib/analytics";

/** Fires a page_view on every client-side route change. */
export default function PageViewTracker() {
  const { pathname, search, hash } = useLocation();

  useEffect(() => {
    // Keep the event name consistent with your analytics.ts
    track("page_view", { path: pathname + search + hash });
  }, [pathname, search, hash]);

  return null;
}
