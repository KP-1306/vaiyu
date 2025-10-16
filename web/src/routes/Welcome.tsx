// web/src/routes/Welcome.tsx
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

type ManagedProperty = { slug: string; name: string };

export default function Welcome() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [propsIManage, setPropsIManage] = useState<ManagedProperty[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const { data: session } = await supabase.auth.getSession();
        if (!session.session) {
          // not signed in → go to signin and keep the intended redirect
          const redirect = sp.get("redirect") || "/welcome";
          nav(`/signin?redirect=${encodeURIComponent(redirect)}`, { replace: true });
          return;
        }

        // fetch properties the user manages; adjust to your schema if different
        const { data, error } = await supabase
          .from("property_members")
          .select("properties(slug,name)")
          .eq("user_id", session.session.user.id);

        if (error) throw error;

        const items =
          (data || [])
            .map((r: any) => r.properties)
            .filter(Boolean) as ManagedProperty[];

        setPropsIManage(items);

        // if user manages at least one property, go to owner space by default
        if (items.length > 0) {
          const slug = sp.get("slug") || items[0].slug;
          nav(`/owner?slug=${encodeURIComponent(slug)}`, { replace: true });
          return;
        }
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <main className="max-w-lg mx-auto p-6">
        <div className="text-sm text-gray-600">Preparing your workspace…</div>
      </main>
    );
  }

  return (
    <main className="max-w-lg mx-auto p-6 space-y-4">
      <h1 className="text-xl font-semibold">Welcome</h1>
      <p className="text-gray-600">
        Choose how you want to use VAiyu.
      </p>

      <div className="grid gap-3">
        <Link to="/guest" className="btn">
          Continue as Guest
        </Link>

        <Link to="/owner/register" className="btn btn-light">
          Register a property (Owner)
        </Link>
      </div>

      <div className="text-xs text-gray-500">
        You can switch between Guest and Owner from the header any time.
      </div>
    </main>
  );
}
