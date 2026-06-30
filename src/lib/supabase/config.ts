// Central place to read Supabase connection settings.
// Until you paste your real keys into .env.local, `isSupabaseConfigured` is
// false and the app shows a friendly setup screen instead of crashing.

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured =
  supabaseUrl.startsWith("http") && supabaseAnonKey.length > 20;
