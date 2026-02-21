// web/src/components/RoleSwitcher.tsx
import { useEffect, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function RoleSwitcher() {
  const [propsIManage, setPropsIManage] = useState<{ slug: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    (async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user?.user) { setLoading(false); return; }
      const { data: rows } = await supabase
        .from("property_members")
        .select("properties(slug,name)")
        .eq("user_id", user.user.id);

      const items = (rows || [])
        .map((r: any) => r.properties)
        .filter(Boolean);

      setPropsIManage(items);
      setLoading(false);
    })();
  }, []);

  // Optional: if user is in owner area but has no properties anymore → push to /welcome
  useEffect(() => {
    if (!loading && loc.pathname.startsWith("/owner") && propsIManage.length === 0) {
      nav("/owner/register", { replace: true });
    }
  }, [loading, propsIManage.length, loc.pathname, nav]);

  return (
    <div className="flex items-center gap-2">
      <Link to="/guest" className="btn btn-light">Guest</Link>
      <div className="relative">
        <button className="btn">Owner</button>
        {/* naive dropdown */}
        <div className="absolute mt-2 rounded-xl border bg-white shadow w-56 p-2">
          {loading && <div className="text-sm text-gray-500 p-2">Loading…</div>}
          {!loading && propsIManage.length === 0 && (
            <Link to="/owner/register" className="block p-2 hover:bg-gray-50 rounded">
              Register a property
            </Link>
          )}
          {!loading && propsIManage.map(p => (
            <Link
              key={p.slug}
              to={`/owner?slug=${encodeURIComponent(p.slug)}`}
              className="block p-2 hover:bg-gray-50 rounded"
            >
              {p.name}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
