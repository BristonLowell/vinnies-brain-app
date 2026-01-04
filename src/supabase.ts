import { createClient } from "@supabase/supabase-js";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export async function ensureAnon() {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) return data.session.user;

  const res = await supabase.auth.signInAnonymously();
  if (res.error) throw res.error;
  return res.data.user!;
}
