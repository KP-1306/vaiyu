// web/src/context/RoleContext.tsx
import { createContext, useContext, useEffect, useState } from "react";

type RoleState = { role: "guest"|"staff"|"manager"|"owner"|"viewer"; hotelSlug: string|null };
const defaultState: RoleState = { role: "guest", hotelSlug: null };

const Ctx = createContext<{
  current: RoleState;
  setCurrent: (r: RoleState) => void;
}>({ current: defaultState, setCurrent: () => {} });

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<RoleState>(() => {
    try { return JSON.parse(localStorage.getItem("va:role") || ""); } catch { return defaultState; }
  });

  useEffect(() => {
    try { localStorage.setItem("va:role", JSON.stringify(current)); } catch {}
  }, [current]);

  return <Ctx.Provider value={{ current, setCurrent }}>{children}</Ctx.Provider>;
}

export function useRole() { return useContext(Ctx); }
