// web/src/routes/Logout.tsx
import { useEffect } from "react";
import { supabase } from "../lib/supabase";

export default function Logout() {
  useEffect(() => {
    supabase.auth.signOut().finally(() => {
      window.location.assign("/signin");
    });
  }, []);
  return null;
}
