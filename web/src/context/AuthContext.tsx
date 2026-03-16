// web/src/context/AuthContext.tsx
import { createContext, useContext, useEffect, useMemo, useState, useRef } from "react";
import { supabase } from "../lib/supabase";

type AuthContextValue = {
  loading: boolean;
  user: any;
  email: string | null;
};

const AuthContext = createContext<AuthContextValue>({
  loading: true,
  user: null,
  email: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const linkingAttempted = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function ensureMapping(uid: string) {
      if (linkingAttempted.current === uid) return;
      linkingAttempted.current = uid;
      const { error } = await supabase.rpc("link_auth_user_to_guest");
      if (error) {
        // Reset ref on failure to allow retry on next state change
        linkingAttempted.current = null;
      }
    }

    const boostrap = async () => {
      setLoading(true);
      try {
        const { data } = await supabase.auth.getUser();
        if (!alive) return;
        const u = data?.user ?? null;
        setUser(u);
        if (u) ensureMapping(u.id);
      } finally {
        if (alive) setLoading(false);
      }
    };

    boostrap();

    const { data: subscription } = supabase.auth.onAuthStateChange((_evt, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) ensureMapping(u.id);
      else linkingAttempted.current = null;
    });

    return () => {
      alive = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const email = user?.email ?? null;

  const value = useMemo(() => ({ loading, user, email }), [loading, user, email]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
