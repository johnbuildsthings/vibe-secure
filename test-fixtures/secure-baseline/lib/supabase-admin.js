import 'server-only';
import { createClient } from '@supabase/supabase-js';

// Server-only: the service role key never reaches the browser.
export const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export async function getUser(req) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user;
}
