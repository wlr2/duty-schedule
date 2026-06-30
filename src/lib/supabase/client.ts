// Supabase client for use in the browser (Client Components).
import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "./config";

export function createClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
