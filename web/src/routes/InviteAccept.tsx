import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Spinner from "../components/Spinner";

export default function InviteAccept() {
  const nav = useNavigate();
  const params = useParams<{ token?: string }>();
  const [sp] = useSearchParams();
  const [msg, setMsg] = useState<string | null>(null);
  const token = useMemo(
    () => params.token || sp.get("code") || sp.get("token") || "",
    [params, sp]
  );

  useEffect(() => {
    let alive = true;

    (async () => {
      // If no token, show a friendly prompt instead of spinning forever.
      if (!token) {
        setMsg("Missing invite code. Open the link from your email, or paste ?code=<token>.");
        return;
      }

      const { data: sess } = await supabase.auth.getSession();
      if (!sess?.session?.user) {
        nav(`/signin?redirect=/owner/invite/accept/${token}`, { replace: true });
        return;
      }

      // Call the definer RPC. Parameter name must match your SQL: _token
      const { data, error } = await supabase.rpc("accept_hotel_invite", { _token: token });
      if (!alive) return;

      if (error) {
        setMsg(error.message || "Invite could not be accepted.");
        return;
      }

      // Success → go to Owner console
      setMsg(data || "Invite accepted.");
      nav("/owner", { replace: true });
    })();

    return () => { alive = false; };
  }, [token, nav]);

  return (
    <main className="min-h-[40vh] grid place-items-center p-6">
      {!msg ? <Spinner label="Accepting invite…" /> : <p className="text-gray-700">{msg}</p>}
    </main>
  );
}
