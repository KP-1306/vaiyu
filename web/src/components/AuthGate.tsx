// web/src/components/AuthGate.tsx
import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

type Props = { children: ReactNode; allow?: Array<"owner"|"staff"|"viewer"> };

export default function AuthGate({ children, allow = ["owner","staff","viewer"] }: Props) {
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
      // a small view or RPC that returns { role }
      const { data, error } = await supabase.from("v_user_roles").select("role").eq("user_id", userId!).limit(1).maybeSingle();
      if (error) throw error;
      return data?.role as "owner"|"staff"|"viewer"|undefined;
    },
  });
}
