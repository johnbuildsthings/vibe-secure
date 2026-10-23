# Payment fixes

Ready-to-adapt patterns for `check-payments` fixes. Replace route, table, field and product names with the real ones. Use the Stripe library and database client the app already has. Env variable names here (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) are examples: keep the app's own names, but never with a browser prefix (`NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`, `EXPO_PUBLIC_`, `PUBLIC_`).

## Check 1: `pay.webhook-unverified`

The rule everywhere: read the raw body, verify it with the signing secret, return 400 if that fails, and use only the event the check returns.

### Next.js App Router (`app/**/route.js`)

This is for the default Node.js runtime. If the route (or the file it lives in) sets `export const runtime = 'edge'`, or the app deploys it as a Vercel or Netlify Edge Function, use the edge version below (`constructEventAsync`) or remove the edge setting.

```js
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function POST(req) {
  const body = await req.text();                       // raw body; never req.json() first
  const signature = req.headers.get('stripe-signature');
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return new Response('Bad signature', { status: 400 }); // stop here; never fall back to the body
  }
  // use `event` only
  return Response.json({ received: true });
}
```

### Next.js Pages Router (`pages/api/**`)

```js
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = { api: { bodyParser: false } };  // keep the raw body

async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  let event;
  try {
    event = stripe.webhooks.constructEvent(await rawBody(req), req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return res.status(400).send('Bad signature');
  }
  // use `event` only
  res.json({ received: true });
}
```

### Express

Register the webhook route with `express.raw` **before** any global `app.use(express.json())`, or exclude it from the JSON parser:

```js
import express from 'express';
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();

app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return res.status(400).send('Bad signature');
  }
  // use `event` only
  res.json({ received: true });
});
app.use(express.json()); // after the webhook route
```

### Edge runtimes: Supabase Edge Functions, Next.js `runtime = 'edge'`, Vercel and Netlify Edge, Deno, Cloudflare Workers

The synchronous `constructEvent` doesn't work here; use the async version with the Web Crypto provider. Supabase Edge Functions (Deno):

```ts
import Stripe from 'npm:stripe';
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  const body = await req.text();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, req.headers.get('stripe-signature')!, Deno.env.get('STRIPE_WEBHOOK_SECRET')!, undefined, cryptoProvider);
  } catch {
    return new Response('Bad signature', { status: 400 });
  }
  // use `event` only
  return Response.json({ received: true });
});
```

A Next.js route on the edge runtime is the same with Node-style imports:

```js
import Stripe from 'stripe';
export const runtime = 'edge';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const cryptoProvider = Stripe.createSubtleCryptoProvider();

export async function POST(req) {
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await req.text(), req.headers.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch {
    return new Response('Bad signature', { status: 400 });
  }
  // use `event` only
  return Response.json({ received: true });
}
```

Deploy a Supabase function with `supabase functions deploy <name> --no-verify-jwt` (Stripe sends no Supabase login; the signature is the check). Set the secrets with `supabase secrets set STRIPE_WEBHOOK_SECRET=…`.

### Python (Flask, FastAPI)

```python
import os
import stripe
stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

@app.post("/api/billing/webhook")                      # Flask
def stripe_webhook():
    try:
        event = stripe.Webhook.construct_event(
            request.data, request.headers.get("Stripe-Signature"), os.environ["STRIPE_WEBHOOK_SECRET"])
    except Exception:                                  # bad payload or bad signature
        return "Bad signature", 400
    # use `event` only
    return {"received": True}

@app.post("/api/billing/webhook")                      # FastAPI
async def stripe_webhook(request: Request):
    payload = await request.body()                     # raw bytes, not await request.json()
    try:
        event = stripe.Webhook.construct_event(payload, request.headers.get("stripe-signature"), os.environ["STRIPE_WEBHOOK_SECRET"])
    except Exception:
        raise HTTPException(status_code=400, detail="Bad signature")
    return {"received": True}
```

### The signing secret (manual steps)

1. Open dashboard.stripe.com → Developers → Webhooks, select the endpoint that points at this route (or add it, choosing the events the handler uses), and reveal its **Signing secret** (`whsec_…`).
2. Add it as a server-only variable (`STRIPE_WEBHOOK_SECRET`) in the host's environment settings (Vercel: Project → Settings → Environment Variables; Netlify: Site configuration → Environment variables; Supabase: `supabase secrets set`) and in the local `.env.local`, then redeploy.
3. For local testing, run `stripe listen --forward-to localhost:3000/<webhook path>` and use the `whsec_…` it prints locally.

If the secret was in a public variable, rename it (drop the prefix) and tell the user that `check-secrets` covers rolling the old secret (Developers → Webhooks → the endpoint → Roll secret).

## Check 2: `pay.client-price`

The browser sends **what** it wants (a product id or sku and a quantity). The server decides **how much**.

### Server catalog

Every route snippet below assumes the usual server-side setup:

```js
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);   // server code only
```

```js
// lib/products.js (server-only)
const PRODUCTS = {
  'starter-pack': { name: 'Starter pack', unit_amount: 900, plan: null },
  'pro-yearly':   { name: 'Pro (yearly)', unit_amount: 9900, plan: 'pro' },
};
export const getProduct = (id) => (Object.hasOwn(PRODUCTS, id) ? { id, ...PRODUCTS[id] } : null);

// checkout route
const { productId, quantity = 1 } = await req.json();
const product = getProduct(productId);
if (!product) return Response.json({ error: 'Unknown product' }, { status: 400 });
const qty = Number(quantity);
if (!Number.isInteger(qty) || qty < 1 || qty > 10) return Response.json({ error: 'Bad quantity' }, { status: 400 });
const session = await stripe.checkout.sessions.create({
  mode: 'payment',
  client_reference_id: user.id,                         // from the verified session (check-auth)
  metadata: { productId: product.id },
  line_items: [{ price_data: { currency: 'usd', product_data: { name: product.name }, unit_amount: product.unit_amount }, quantity: qty }],
  success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${origin}/pricing`,
});
```

Products in a database work the same way: look the row up by id on the server and take the amount from it, never from the request.

### Stripe price ids with an allowlist

```js
const ALLOWED_PRICES = new Set([process.env.STRIPE_PRICE_PRO_MONTHLY, process.env.STRIPE_PRICE_PRO_YEARLY]);
const { priceId } = await req.json();
if (!ALLOWED_PRICES.has(priceId)) return Response.json({ error: 'Unknown price' }, { status: 400 });
await stripe.checkout.sessions.create({ mode: 'subscription', line_items: [{ price: priceId, quantity: 1 }], /* … */ });
```

### PaymentIntents and carts

```js
const { items } = await req.json();                    // [{ productId, quantity }]
let amount = 0;
for (const { productId, quantity } of items) {
  const product = getProduct(productId);
  const qty = Number(quantity);
  if (!product || !Number.isInteger(qty) || qty < 1 || qty > 10) {     // no negative, zero or fractional quantities
    return Response.json({ error: 'Bad item' }, { status: 400 });
  }
  amount += product.unit_amount * qty;
}
const intent = await stripe.paymentIntents.create({ amount, currency: 'usd', metadata: { cart: JSON.stringify(items.map((i) => i.productId)) } });
```

### Coupons

Prefer `allow_promotion_codes: true` (Stripe checks the code and its limits). If the app takes a code, look it up on the server (`stripe.promotionCodes.list({ code, active: true })`) instead of passing a coupon id from the request.

## Check 3: `pay.client-subscription-status`

The rule: only the verified webhook (or a server-side Stripe lookup) writes `plan`, `credits` or paid status, and it grants exactly what was paid for.

The webhook snippets run inside the verified handler from check 1 (`event` is what `constructEvent` returned, `stripe` and the server-side `admin` database client are set up as there).

### Fulfilment in the webhook

```js
async function fulfil(session) {
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') return; // wait for async payments
  const product = getProduct(session.metadata?.productId);        // written by your checkout from the catalog
  if (!product?.plan) return;                                      // not a plan purchase
  await admin.from('accounts').update({ plan: product.plan }).eq('id', session.client_reference_id);
}

switch (event.type) {                                             // grant only on events that mean "paid"
  case 'checkout.session.completed':
  case 'checkout.session.async_payment_succeeded':                 // bank debits and vouchers pay later
    await fulfil(event.data.object);
    break;
  default:
    break;                                                         // every other event grants nothing
}
```

The same applies to Payment Links and the Pricing Table: they also end in `checkout.session.completed`, so map the bought price to what you grant.

### Credits and other grants that add up

Setting `plan = 'pro'` twice is harmless; adding 100 credits twice is not. Record the checkout session (or event) id as used, with a unique constraint, and grant only when that insert succeeds:

```sql
create table fulfilled_checkouts (session_id text primary key, account_id uuid not null, created_at timestamptz default now());
```

```js
async function grantCredits(session, credits) {
  const { error } = await admin.from('fulfilled_checkouts').insert({ session_id: session.id, account_id: session.client_reference_id });
  if (error) return;                                               // already granted (unique violation): do nothing
  await admin.rpc('add_credits', { account: session.client_reference_id, amount: credits });
}
```

Safer still, do both in one database function so a crash between the two steps can't lose the grant:

```sql
create function grant_credits_once(p_session text, p_account uuid, p_amount int) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into fulfilled_checkouts (session_id, account_id) values (p_session, p_account);
  update accounts set credits = credits + p_amount where id = p_account;
  return true;
exception when unique_violation then
  return false;
end $$;
revoke execute on function grant_credits_once(text, uuid, int) from public, anon, authenticated;
```

Call it only from server code with the admin client. The success page and the webhook can both call it: whichever runs first grants, the other does nothing.

### Subscriptions: grant and revoke from the subscription's status

```js
const PLAN_BY_PRICE = { [process.env.STRIPE_PRICE_PRO_MONTHLY]: 'pro', [process.env.STRIPE_PRICE_PRO_YEARLY]: 'pro' };

async function syncSubscription(subscriptionId) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);   // fresh copy: events can arrive out of order
  const active = sub.status === 'active' || sub.status === 'trialing';
  const plan = active ? PLAN_BY_PRICE[sub.items.data[0]?.price.id] ?? 'free' : 'free';
  await admin.from('accounts').update({ plan, subscription_status: sub.status }).eq('stripe_customer_id', sub.customer);
}

switch (event.type) {
  case 'customer.subscription.created':
  case 'customer.subscription.updated':
  case 'customer.subscription.deleted':
    await syncSubscription(event.data.object.id);
    break;
  case 'invoice.payment_failed':
  case 'invoice.paid': {
    const inv = event.data.object;                                 // newer API versions moved the field under parent
    const subId = inv.subscription ?? inv.parent?.subscription_details?.subscription;
    if (subId) await syncSubscription(typeof subId === 'string' ? subId : subId.id);
    break;
  }
}
```

`past_due` keeps access off here; if the app wants a grace period, allow `past_due` explicitly and say so. Add these events to the endpoint in Stripe (Developers → Webhooks → the endpoint → Select events).

### Stripe customer ids come from your records

```js
// Before: const { customerId } = await req.json();
const user = await requireUser(req);                               // verified session (check-auth)
const { data: account } = await admin.from('accounts').select('stripe_customer_id').eq('id', user.id).single();
if (!account?.stripe_customer_id) return Response.json({ error: 'No billing account' }, { status: 400 });
const portal = await stripe.billingPortal.sessions.create({ customer: account.stripe_customer_id, return_url: `${origin}/account` });
```

Store the customer id when the webhook first sees it (`session.customer` on `checkout.session.completed`), never from the browser.

When the checkout uses Stripe price ids, check what was bought instead of metadata: `const { data } = await stripe.checkout.sessions.listLineItems(session.id); const priceIds = data.map((l) => l.price.id);` and map each allowed price id to its plan. For subscriptions, set and revoke the plan from `customer.subscription.created/updated/deleted` using `subscription.status` (`active`, `trialing`) and the subscription item's `price.id`.

### Success page that checks with Stripe

```js
// app/checkout/success/page.jsx (server component). Next 15+: searchParams is a promise.
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function SuccessPage({ searchParams }) {
  const { session_id } = await searchParams;
  const user = await requireUser();                                // verified session (check-auth)
  let paid = false;
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    paid = session.payment_status === 'paid' && session.client_reference_id === user.id;
  } catch {
    paid = false;                                                  // unknown or fake id: treat as not paid
  }
  return paid ? <p>You're all set.</p> : <p>We're confirming your payment…</p>;
}
```

Let the webhook do the granting. If the page must grant too, call the same once-only function as the webhook (see "Credits and other grants that add up"), keyed by the session id, so a reload grants nothing more. Setting a fixed plan is safe to repeat; adding credits is not.

Never grant from `?paid=true`, `?plan=…`, or a `session_id` the server didn't retrieve and check.

### Moving a browser plan write to the webhook

1. Delete the browser code that sets `plan` / `credits` (name each `file:line`). The browser now only starts checkout and, afterwards, re-reads the account.
2. Do the write in the verified webhook as above, with the server-side admin client.
3. Make sure users can't write the field themselves: `/vibe-secure:check-database-rules` covers the policy or rules change (column grants, a trigger, or Firestore rules that block the field).

`may_break`: the plan now appears a few seconds after payment instead of instantly; show "processing" on the success page and re-fetch the account.
