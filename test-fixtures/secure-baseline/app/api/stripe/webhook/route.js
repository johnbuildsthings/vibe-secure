import Stripe from 'stripe';
import { admin } from '../../../../lib/supabase-admin.js';
import { findProduct } from '../../../../lib/catalog.js';

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
    const session = event.data.object;
    const product = findProduct(session.metadata?.sku);
    // Grant only what was actually paid for, and only once Stripe says it is paid.
    if (product && session.payment_status === 'paid') {
      await admin.from('profiles').update({ plan: product.plan }).eq('id', session.client_reference_id);
    }
  }
  return Response.json({ received: true });
}
