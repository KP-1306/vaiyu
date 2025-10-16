// web/src/components/Empty.tsx
import type { ReactNode } from "react";

type EmptyProps = {
  title?: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
};

export default function Empty({
  title = "Nothing here yet",
  hint,
  action,
  className = "",
}: EmptyProps) {
  return (
    <section
      role="status"
      aria-live="polite"
      className={`rounded-xl border border-black/10 bg-white p-6 text-center ${className}`}
    >
      <div className="text-gray-800 font-medium">{title}</div>
      {hint && <p className="mt-1 text-sm text-gray-500">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </section>
  );
}
