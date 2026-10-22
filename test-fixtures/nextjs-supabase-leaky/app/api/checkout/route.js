import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function POST(req) {
  const { name, price, quantity } = await req.json();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: { currency: 'usd', product_data: { name }, unit_amount: price },
      quantity,
    }],
    success_url: 'http://localhost:3000/thanks',
    cancel_url: 'http://localhost:3000/cart',
  });
  return Response.json({ url: session.url });
}
