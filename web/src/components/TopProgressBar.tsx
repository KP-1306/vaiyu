import { useEffect, useRef } from "react";
import { useNavigation } from "react-router-dom";

/**
 * Minimal top progress bar driven by react-router navigation state.
 * No deps: just CSS width animation.
 */
export default function TopProgressBar() {
  const nav = useNavigation();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (nav.state === "loading") {
      el.style.opacity = "1";
      el.style.transform = "scaleX(0.15)";
      // kick off a slow grow to suggest work is happening
      requestAnimationFrame(() => {
        el.style.transform = "scaleX(0.6)";
      });
    } else {
      // complete & hide
      el.style.transform = "scaleX(1)";
      setTimeout(() => { el.style.opacity = "0"; el.style.transform = "scaleX(0)"; }, 200);
    }
  }, [nav.state]);

  return (
    <div className="top-progress">
      <div className="top-progress__bar" ref={ref} />
    </div>
  );
}
