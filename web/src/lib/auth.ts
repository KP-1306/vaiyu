// web/src/lib/auth.ts
import { supabase } from "./supabase";

export async function signOutEverywhere() {
  try {
    // invalidate on all devices (safe even if not enabled)
    await supabase.auth.signOut({ scope: "global" } as any);
  } catch {
    // ignore
  }

  // local safety clear
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("sb-") && k.endsWith("-auth-token"))
      .forEach((k) => localStorage.removeItem(k));
    localStorage.removeItem("va:guest");
    sessionStorage.clear();
  } catch {
    // ignore
  }
}
