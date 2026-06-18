// web/src/components/owner/AnalyticsRoleGuard.tsx
// Route-level authorization for the Owner Analytics AND Ops Manager Analytics
// pages. Uses the SAME server-authoritative predicate the v_owner_*/v_ops_*
// analytics views enforce (vaiyu_can_view_hotel_analytics), so the UI gate and
// the data scope can never drift: a non-manager is denied the page here AND
// would get zero rows from the views. Normal staff must not see analytics at all.
// Mirrors FinanceRoleGuard (vaiyu_is_hotel_finance_manager) for the finance pages.
//
// Slug source: path param (/owner/:slug/analytics) OR ?slug= query param
// (/ops/analytics?slug=…), so one guard covers both analytics routes.

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { DarkLoading, DarkErrorPanel } from "./DarkShell";

export default function AnalyticsRoleGuard({ children }: { children: React.ReactNode }) {
  const params = useParams<{ slug?: string }>();
  const [searchParams] = useSearchParams();
  const slug = params.slug ?? searchParams.get("slug") ?? undefined;
  const [state, setState] = useState<"loading" | "allowed" | "denied" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!slug) {
        setState("error");
        setErrorMsg("Missing hotel slug.");
        return;
      }
      const { data: hotel, error: hErr } = await supabase
        .from("hotels")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (cancelled) return;
      if (hErr || !hotel) {
        setState("error");
        setErrorMsg(hErr?.message ?? "Hotel not found.");
        return;
      }
      const { data, error } = await supabase.rpc("vaiyu_can_view_hotel_analytics", {
        p_hotel_id: hotel.id,
      });
      if (cancelled) return;
      if (error) {
        setState("error");
        setErrorMsg(error.message);
        return;
      }
      setState(data === true ? "allowed" : "denied");
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state === "loading") return <DarkLoading message="Verifying access…" />;
  if (state === "error")
    return <DarkErrorPanel message={errorMsg ?? "Authorization check failed."} />;
  if (state === "denied")
    return (
      <DarkErrorPanel message="You don't have permission to view analytics for this hotel. Ask an owner or manager to grant access." />
    );
  return <>{children}</>;
}
