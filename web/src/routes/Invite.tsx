import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Referral = {
  id: string;
  user_id: string;
  code: string;
  created_at: string;
};

function genCode(len = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export default function Invite() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [ref, setRef] = useState<Referral | null>(null);

  const link = useMemo(() => {
    if (!ref?.code) return "";
    // send friends to signup with your referral code
    const origin = typeof window !== "undefined" ? window.location.origin : "https://vaiyu.co.in";
    // if you prefer a landing later, swap to `${origin}/join?r=${ref.code}`
    return `${origin}/signup?ref=${encodeURIComponent(ref.code)}`;
  }, [ref]);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true); setErr(null);

      const { data: userRes, error: uErr } = await supabase.auth.getUser();
      if (uErr || !userRes?.user) {
        setErr("Please sign in to get your invite link.");
        setLoading(false);
        return;
      }
      const uid = userRes.user.id;

      // 1) try existing
      const { data: existing, error: selErr } = await supabase
        .from("referrals")
        .select("id,user_id,code,created_at")
        .eq("user_id", uid)
        .limit(1)
        .maybeSingle();

      if (selErr) { setErr(selErr.message); setLoading(false); return; }

      if (existing) {
        if (live) { setRef(existing as Referral); setLoading(false); }
        return;
      }

      // 2) create one (retry a few times on unique conflict)
      let refRow: Referral | null = null;
      for (let i = 0; i < 4; i++) {
        const code = genCode();
        const { data, error } = await supabase
          .from("referrals")
          .insert({ user_id: uid, code })
          .select("id,user_id,code,created_at")
          .maybeSingle();
        if (!error && data) { refRow = data as Referral; break; }
        if (error?.message?.toLowerCase().includes("duplicate")) continue; // try again
        if (error) { setErr(error.message); break; }
      }
      if (live) setRef(refRow), setLoading(false);
    })();
    return () => { live = false; };
  }, []);

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    alert("Copied your invite link!");
  }

  async function nativeShare() {
    if (!link || !("share" in navigator)) return copy();
    try {
      // @ts-ignore
      await navigator.share({ title: "Join VAiyu", text: "Here’s my invite link:", url: link });
    } catch { /* ignore */ }
  }

  return (
    <main className="max-w-2xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Invite & earn</h1>
        <a className="btn btn-light" href="/rewards">Back to rewards</a>
      </div>

      <section className="rounded-2xl border bg-white/90 shadow-sm p-6">
        {loading && <p>Preparing your invite link…</p>}
        {!loading && err && <p className="text-red-600">{err}</p>}

        {!loading && !err && ref && (
          <>
            <p className="text-gray-700">
              Share this link with friends. When they sign up and complete a partner stay,
              you earn credits.
            </p>

            <div className="mt-4 flex flex-col gap-2">
              <label className="text-sm text-gray-500">Your link</label>
              <input
                className="input"
                value={link}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="flex gap-2 mt-2">
                <button className="btn" onClick={copy}>Copy link</button>
                <button className="btn btn-light" onClick={nativeShare}>Share…</button>
              </div>
              <p className="text-xs text-gray-500 mt-3">Your code: <b>{ref.code}</b></p>
            </div>
          </>
        )}
      </section>

      <section className="mt-6 rounded-2xl border bg-white/90 p-6">
        <h2 className="font-medium mb-2">How it works</h2>
        <ol className="list-decimal ml-5 space-y-1 text-sm text-gray-700">
          <li>Share your link with friends.</li>
          <li>They sign up and book a partner stay.</li>
          <li>After their stay, credits appear in your rewards.</li>
        </ol>
      </section>
    </main>
  );
}
