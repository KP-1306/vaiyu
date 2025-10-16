import { useEffect, useState } from "react";
import { supa } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export default function UsageMeter({ hotelId }: { hotelId?: string|null }) {
  const [used, setUsed] = useState<number|null>(null);
  const [budget, setBudget] = useState<number|null>(null);
  const [err, setErr] = useState<string|null>(null);

  useEffect(() => {
    let ok = true;
    (async () => {
      try {
        const q = hotelId
          ? supa.from("ai_usage").select("used_tokens,budget_tokens").eq("hotel_id", hotelId).order("month_utc", { ascending: false }).limit(1)
          : supa.from("ai_usage").select("used_tokens,budget_tokens").order("month_utc", { ascending: false }).limit(1);
        const { data, error } = await q;
        if (error) throw error;
        const row = data?.[0];
        if (ok) {
          setUsed(row?.used_tokens ?? 0);
          setBudget(row?.budget_tokens ?? 0);
        }
      } catch (e: any) {
        if (ok) setErr(e.message ?? String(e));
      }
    })();
    return () => { ok = false; };
  }, [hotelId]);

  if (err) return <div className="text-sm text-red-600">{err}</div>;
  if (used === null || budget === null) return <div className="text-sm text-muted-foreground">Loading usage…</div>;
  if (budget === 0 && used === 0) return <div className="text-sm text-muted-foreground">No usage yet.</div>;

  const pct = Math.min(100, Math.round((used / Math.max(1, budget)) * 100));

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="font-medium">AI Usage (this month)</div>
        <div className="text-sm">{pct}%</div>
      </div>
      <Progress className="mt-2" value={pct} aria-label="Monthly AI usage" />
      <div className="mt-2 text-sm text-muted-foreground">
        {used.toLocaleString()} / {budget.toLocaleString()} tokens
      </div>
    </Card>
  );
}
