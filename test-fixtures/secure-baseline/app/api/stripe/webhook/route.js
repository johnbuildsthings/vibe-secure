import Stripe from 'stripe';
import { admin } from '../../../../lib/supabase-admin.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function POST(req) {
  const signature = req.headers.get('stripe-signature');
  const body = await req.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return Response.json({ error: 'Bad signature' }, { status: 400 });
  }
  if (event.type === 'checkout.session.completed') {
    await admin.from('profiles').update({ plan: 'pro' }).eq('id', event.data.object.client_reference_id);
  }
  return Response.json({ received: true });
}
