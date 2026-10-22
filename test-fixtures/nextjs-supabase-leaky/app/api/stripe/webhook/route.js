import { createClient } from '@supabase/supabase-js';

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY);

export async function POST(req) {
  const event = JSON.parse(await req.text());
  if (event.type === 'checkout.session.completed') {
    await admin.from('profiles').update({ plan: 'pro' }).eq('id', event.data.object.client_reference_id);
  }
  return Response.json({ received: true });
}
