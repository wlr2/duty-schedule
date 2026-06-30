// Supabase client for use on the server (Server Components, Server Actions,
// Route Handlers). In Next.js 16 `cookies()` is async, so this is async too.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAnonKey, supabaseUrl } from "./config";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // `setAll` was called from a Server Component, where setting cookies
          // is not allowed. This is safe to ignore because proxy.ts refreshes
          // the session on every request.
        }
      },
    },
  });
}
