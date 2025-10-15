// web/src/components/AuthGate.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import Spinner from "./Spinner";

type Props = { children: React.ReactNode; redirectTo?: string };

export default function AuthGate({ children, redirectTo = "/signin" }: Props) {
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => {
      setAuthed(!!sess);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-[40vh] grid place-items-center">
        <Spinner label="Checking session…" />
      </div>
    );
  }
  if (!authed) {
    // soft redirect (preserves SPA feel)
    if (typeof window !== "undefined") window.location.assign(redirectTo);
    return null;
  }
  return <>{children}</>;
}
