import Stripe from 'stripe';
import { getUser } from '../../../lib/supabase-admin.js';
import { findProduct } from '../../../lib/catalog.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function POST(req) {
  const user = await getUser(req);
  if (!user) return Response.json({ error: 'Sign in first' }, { status: 401 });
  const { sku } = await req.json();
  const item = findProduct(sku);
  if (!item) return Response.json({ error: 'Unknown product' }, { status: 400 });
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    client_reference_id: user.id,
    metadata: { sku },
    line_items: [{
      price_data: { currency: 'usd', product_data: { name: item.name }, unit_amount: item.unit_amount },
      quantity: 1,
    }],
    success_url: 'https://example.com/thanks',
    cancel_url: 'https://example.com/cart',
  });
  return Response.json({ url: session.url });
}
