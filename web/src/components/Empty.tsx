export default function Empty({
  title = "Nothing here yet",
  hint,
  action,
}: { title?: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-6 text-center">
      <div className="text-gray-800 font-medium">{title}</div>
      {hint && <div className="mt-1 text-sm text-gray-500">{hint}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
