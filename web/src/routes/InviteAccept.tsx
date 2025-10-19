// web/src/routes/InviteAccept.tsx
import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import Spinner from "../components/Spinner";

export default function InviteAccept() {
  const { token } = useParams();
  const nav = useNavigate();
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!token) return;
    let run = true;
    (async () => {
      // Ensure user is signed in
      const { data } = await supabase.auth.getSession();
      if (!data?.session) {
        setMsg("Please sign in first, then open the invite link again.");
        return;
      }
      const { data: res, error } = await supabase.rpc("accept_hotel_invite", { _token: token });
      if (!run) return;
      if (error) {
        setMsg(error.message);
      } else {
        setOk(true);
        setMsg(res || "Invite accepted!");
      }
    })();
    return () => { run = false; };
  }, [token]);

  if (!msg) {
    return (
      <main className="min-h-[60vh] grid place-items-center">
        <Spinner label="Accepting invite…" />
      </main>
    );
  }

  return (
    <main className="max-w-lg mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-2">{ok ? "You're in!" : "Oops"}</h1>
      <p className="text-sm text-gray-700">{msg}</p>
      <div className="mt-4 flex gap-2">
        <button className="btn" onClick={() => nav("/owner")}>Go to Owner console</button>
        <Link className="btn btn-light" to="/guest">Guest dashboard</Link>
      </div>
    </main>
  );
}
