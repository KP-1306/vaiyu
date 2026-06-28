// web/src/components/AuthGate.tsx
import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { getCurrentSession } from "../lib/auth";

type Props = { children: ReactNode; allow?: string[] };

export default function AuthGate({ children, allow = ["owner", "staff", "viewer", "OWNER", "STAFF", "MANAGER"] }: Props) {
  const loc = useLocation();
  const { data: session, isPending } = useSessionQuery();
  const { data: role } = useRoleQuery(session?.user?.id);

  // While the session query is still resolving, `session` is `undefined`.
  // Treating that as "logged out" bounced authenticated users to /signin on
  // every hard-refresh / direct-nav to a gated route (the "Checking session"
  // detour). Hold with a lightweight spinner until the query actually settles.
  if (isPending) {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-sky-600" />
          <div className="text-sm text-gray-500">Loading…</div>
        </div>
      </div>
    );
  }

  if (!session) return <Navigate to={`/signin?redirect=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;

  if (role && !allow.includes(role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function useSessionQuery() {
  return useQuery({
    queryKey: ["session"],
    // getSession() is bounded at the client (lib/supabase.ts), so this query
    // always settles — a hung read resolves to null and the gate redirects to
    // /signin instead of leaving its loading state stuck forever.
    queryFn: async () => {
      return await getCurrentSession();
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
}

function useRoleQuery(userId?: string) {
  return useQuery({
    queryKey: ["role", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hotel_members")
        .select("role")
        .eq("user_id", userId!)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("Error fetching role:", error);
        return null;
      }

      // Return the role or null if not found (React Query doesn't like undefined)
      return (data?.role as "OWNER" | "MANAGER" | "STAFF" | "viewer") || null;
    },
  });
}
