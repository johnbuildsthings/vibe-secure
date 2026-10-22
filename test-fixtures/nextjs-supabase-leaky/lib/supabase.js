import { createClient } from '@supabase/supabase-js';

// Used from client components. Bundled into the browser.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY,
);
