// web/src/components/ThemeProvider.tsx
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';

export type ThemeConfig = { brand?: string; mode?: 'light' | 'dark' };
type ThemeCtx = {
  theme: ThemeConfig;
  setTheme: (t: ThemeConfig) => void;
  setMode: (m: 'light' | 'dark') => void;
  setBrand: (hex: string) => void;
  toggleMode: () => void;
};

const ThemeContext = createContext<ThemeCtx>({
  theme: {},
  setTheme: () => {},
  setMode: () => {},
  setBrand: () => {},
  toggleMode: () => {},
});

const STORAGE_KEY = 'vaiyu.theme';
const DEFAULT_BRAND = '#145AF2';

function applyThemeToDocument(t?: ThemeConfig) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const brand = t?.brand || DEFAULT_BRAND;
  const isDark = t?.mode === 'dark';

  // Core palette variables used across the app
  root.style.setProperty('--brand', brand);
  root.style.setProperty('--bg', isDark ? '#0b0d12' : '#ffffff');
  root.style.setProperty('--fg', isDark ? '#e7edf6' : '#0b0d12');
  root.style.setProperty('--muted', isDark ? '#9aa4b2' : '#61708a');
  root.style.setProperty('--card', isDark ? '#11141b' : '#f6f8fb');
  root.style.setProperty('--border', isDark ? '#212635' : '#dde3ee');

  // Class toggle for any global dark styles
  if (isDark) root.classList.add('dark');
  else root.classList.remove('dark');

  // Optional marker for debugging/css targeting
  root.setAttribute('data-theme', isDark ? 'dark' : 'light');
}

export function ThemeProvider({
  children,
  initialTheme,
}: {
  children: React.ReactNode;
  initialTheme?: ThemeConfig; // e.g., pass hotel.theme from API
}) {
  // Load from storage once, fallback to initialTheme, finally to defaults
  const [theme, setThemeState] = useState<ThemeConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return initialTheme ?? { brand: DEFAULT_BRAND, mode: 'light' };
  });

  // Apply to document on changes
  useEffect(() => {
    applyThemeToDocument(theme);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
    } catch {}
  }, [theme?.brand, theme?.mode]);

  // If upstream provides a new initialTheme (e.g. Owner updates), merge it in
  useEffect(() => {
    if (!initialTheme) return;
    setThemeState((prev) => {
      // Only update if something actually changed
      const next = { brand: initialTheme.brand ?? prev.brand, mode: initialTheme.mode ?? prev.mode };
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    });
  }, [initialTheme?.brand, initialTheme?.mode]);

  const setTheme = useCallback((t: ThemeConfig) => setThemeState(t), []);
  const setMode = useCallback((m: 'light' | 'dark') => setThemeState((p) => ({ ...p, mode: m })), []);
  const toggleMode = useCallback(
    () => setThemeState((p) => ({ ...p, mode: p.mode === 'dark' ? 'light' : 'dark' })),
    []
  );
  const setBrand = useCallback((hex: string) => setThemeState((p) => ({ ...p, brand: hex || DEFAULT_BRAND })), []);

  const value = useMemo(
    () => ({ theme, setTheme, setMode, setBrand, toggleMode }),
    [theme, setTheme, setMode, setBrand, toggleMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
