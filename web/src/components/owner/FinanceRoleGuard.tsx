// web/src/components/owner/FinanceRoleGuard.tsx
// Route-level authorization for pricing / finance pages.
// Uses the server-authoritative RPC vaiyu_is_hotel_finance_manager.
// RLS is still the final check on every write; this guard prevents
// non-finance staff from rendering the UI at all.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { DarkLoading, DarkErrorPanel } from "./DarkShell";
import { useOwnerT } from "../../i18n/useOwnerT";

export default function FinanceRoleGuard({ children }: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  const t = useOwnerT("owner-cards");
  const [state, setState] = useState<"loading" | "allowed" | "denied" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!slug) {
        setState("error");
        setErrorMsg(t("guard.missingSlug", "Missing hotel slug."));
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
        setErrorMsg(hErr?.message ?? t("guard.hotelNotFound", "Hotel not found."));
        return;
      }
      const { data, error } = await supabase.rpc("vaiyu_is_hotel_finance_manager", {
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

  if (state === "loading") return <DarkLoading message={t("guard.verifyingAccess", "Verifying access…")} />;
  if (state === "error")
    return <DarkErrorPanel message={errorMsg ?? t("guard.authFailed", "Authorization check failed.")} />;
  if (state === "denied")
    return (
      <DarkErrorPanel message={t("guard.deniedFinance", "You don't have permission to view pricing or finance for this hotel. Ask an owner or finance manager to grant access.")} />
    );
  return <>{children}</>;
}
