import { createClient } from '@supabase/supabase-js';

// The anon key is public by design. Row Level Security is what protects the data.
export const supabase = createClient(
  'http://127.0.0.1:4101',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZha2VyZWYiLCJyb2xlIjoiYW5vbiJ9.FAKESIGNATURE',
);
