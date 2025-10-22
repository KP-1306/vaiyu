// web/src/context/AuthContext.tsx
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type AuthContextValue = {
  loading: boolean;
  user: ReturnType<typeof supabase.auth.getUser> extends Promise<{ data: infer D }>
    ? NonNullable<D>["user"] | null
    : any;
  email: string | null;
};

const AuthContext = createContext<AuthContextValue>({
  loading: true,
  user: null,
  email: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthContextValue["user"]>(null);

  useEffect(() => {
    let alive = true;

    const bootstrap = async () => {
      setLoading(true);
      try {
        const { data } = await supabase.auth.getUser();
        if (!alive) return;
        setUser(data?.user ?? null);
      } finally {
        if (alive) setLoading(false);
      }
    };

    bootstrap();

    const { data: subscription } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUser(session?.user ?? null);
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
