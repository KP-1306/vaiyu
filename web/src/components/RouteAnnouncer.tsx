import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

export default function RouteAnnouncer() {
  const loc = useLocation();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const title = document.title || "Page changed";
    if (ref.current) ref.current.textContent = title;
  }, [loc]);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      ref={ref}
    />
  );
}
