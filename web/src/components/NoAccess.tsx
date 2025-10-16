// web/src/components/NoAccess.tsx
export default function NoAccess({
  title = "You don’t have access",
  hint = "Ask an owner to grant permissions for this page.",
}: { title?: string; hint?: string }) {
  return (
    <section
      role="alert"
      aria-live="polite"
      className="rounded-xl border p-6 bg-amber-50"
    >
      <div className="text-base font-semibold">{title}</div>
      <p className="text-sm text-gray-700 mt-1">{hint}</p>
    </section>
  );
}
