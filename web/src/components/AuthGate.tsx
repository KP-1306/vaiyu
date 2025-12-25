// web/src/components/AuthGate.tsx
import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

type Props = { children: ReactNode; allow?: string[] };

export default function AuthGate({ children, allow = ["owner", "staff", "viewer", "OWNER", "STAFF", "MANAGER"] }: Props) {
  const loc = useLocation();
  const { data: session } = useSessionQuery();
  const { data: role } = useRoleQuery(session?.user?.id);

  if (!session) return <Navigate to={`/signin?redirect=${encodeURIComponent(loc.pathname)}`} replace />;

  if (role && !allow.includes(role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function useSessionQuery() {
  return useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession();
      return data.session ?? null;
    },
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
