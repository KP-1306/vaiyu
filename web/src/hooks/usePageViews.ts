import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { track } from "../lib/analytics";

export function usePageViews() {
  const loc = useLocation();
  useEffect(() => {
    track("page_view", { path: loc.pathname });
  }, [loc.pathname]);
}
