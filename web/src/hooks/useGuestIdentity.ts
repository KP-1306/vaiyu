// web/src/hooks/useGuestIdentity.ts
//
// Small hook to fetch and cache the central guest identity
// so we can auto-prefill forms (pre-checkin, reg card, etc.)

import { useEffect, useState } from "react";
import { fetchGuestIdentity, GuestIdentity } from "../lib/api";
import { supabase } from "../lib/supabase";

type UseGuestIdentityResult = {
  identity: GuestIdentity | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setIdentity: React.Dispatch<React.SetStateAction<GuestIdentity | null>>;
};

export function useGuestIdentity(): UseGuestIdentityResult {
  const [identity, setIdentity] = useState<GuestIdentity | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // Best-effort: use Supabase session token if available.
      let token: string | undefined;
      try {
        const { data } = await supabase.auth.getSession();
        token = data.session?.access_token;
      } catch {
        token = undefined;
      }

      const id = await fetchGuestIdentity(token);
      setIdentity(id);
    } catch (e: any) {
      console.error("[useGuestIdentity] load error", e);
      setError(e?.message || "Could not load profile");
      setIdentity(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) {
        // noop – just avoid setting state after unmount
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    identity,
    loading,
    error,
    refresh: load,
    setIdentity,
  };
}
