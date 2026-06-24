// Minimal Supabase client (browser)
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY } from "./supabaseKey";

const url = import.meta.env.VITE_SUPABASE_URL as string;

export const supa = createClient(url, SUPABASE_PUBLISHABLE_KEY);
