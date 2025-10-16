export default function NoAccess({
  title = "No access",
  hint = "Ask your admin to grant permissions.",
}: { title?: string; hint?: string }) {
  return (
    <div className="rounded-2xl border p-6 bg-muted/30">
      <div className="text-lg font-semibold">{title}</div>
      <div className="text-sm text-muted-foreground mt-1">{hint}</div>
    </div>
  );
}
