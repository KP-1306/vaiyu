import { createContext, useContext, useEffect, useMemo, useState } from "react";

type ThemeConfig = { brand?: string; mode?: "light" | "dark" };
type ThemeCtx = { theme: ThemeConfig; setTheme: (t: ThemeConfig) => void; };

const Ctx = createContext<ThemeCtx>({ theme: {}, setTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<ThemeConfig>({});
  useEffect(() => {
    if (theme.brand) document.documentElement.style.setProperty("--brand", theme.brand);
    document.documentElement.setAttribute("data-theme", theme.mode === "dark" ? "dark" : "light");
  }, [theme]);
  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useTheme = () => useContext(Ctx);
