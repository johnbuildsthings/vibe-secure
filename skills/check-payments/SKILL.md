---
name: check-payments
description: Use when auditing an app that takes payments with Stripe for money holes, such as webhooks that don't check Stripe's signature, checkout routes that take the price from the browser, and plans, subscriptions or credits granted from data the buyer controls instead of a verified payment.
disable-model-invocation: true
---

# Check payments

## What this protects against

Your app decides who has paid. If it believes what the browser says ("I paid", "my price is 1 cent", "my plan is pro") or believes any request that claims to come from Stripe, a stranger can get your product for free, set their own price, or mark orders as paid. The only things your server can trust are prices it looks up itself, and events it has proven came from Stripe: by checking the webhook signature, or by asking Stripe's API directly.

OWASP: `A08:2025 Software or Data Integrity Failures` for all three checks.

## Applies when

An app in `stack.json` has `stripe` in `payments`. `detect-stack` only reads JavaScript dependencies, so for a Python app (and any app whose `payments` is empty) also search its code for `import stripe`, `from stripe`, `require('stripe')`, `from 'stripe'` and `api.stripe.com`; if any hit is app code, the skill applies to that app too. Run it once per such app.

If no app uses Stripe, write `"findings": []` and say in one line that the payment checks were skipped because no Stripe code was found. Other payment providers (Paddle, Lemon Squeezy, PayPal) aren't covered: if you see one, say so in one line.

## How to run

Follow the run contract in `<root>/shared/area-skill-template.md` (Part 2). In short:

- `<root>` = two levels up from this skill's base directory (or `Plugin root:` in a dispatch prompt). Project root = the current directory, or the `Project root:` from a dispatch prompt. In that case, use that path wherever a command below says `.`.
- **Mode:** `audit` unless the request says `verify <check> <subject>`.
- **Time stamps:** `node -e "console.log(new Date().toISOString())"`. Never guess.
- **Alone, audit:** `node <root>/scripts/init-workspace.mjs .`, then `node <root>/scripts/detect-stack.mjs .` if `.vibe-secure/stack.json` is missing → run the checks → write `.vibe-secure/findings/payments.json` (always, `"findings": []` when clean) → `node <root>/scripts/validate-findings.mjs .vibe-secure/findings/payments.json` until it passes → follow `<root>/shared/report-and-fix.md` (if the user asked for a report only, still run `merge-findings`, show the report and save it to `.vibe-secure/report-payments.md`; then stop).
- **`dispatched: audit`:** run the checks, write and validate the file, reply with counts, "already good" lines and skipped checks. No report, no fix loop.
- **`verify <check> <subject>`:** no init or detect-stack (read `stack.json`, `package.json` or the Python manifest directly); re-run that one check for that subject, reply `PRESENT` or `GONE` plus evidence, write nothing.
- **Dispatched project root:** substitute it for `.` in every command.
- **Search scope:** never look inside `node_modules`, `.next`, `dist`, `build`, `out`, `.vercel`, `.vibe-secure`, `*.min.js` or lockfiles.
- **Commands:** one plain command per Bash call: no `&&`, `;`, `||`, `$?`, `$(…)`, `{…}` or pipes into other programs, because those need extra approval and may be refused. Use the Read and Grep tools for files. Don't write helper scripts or scratch files, in the project or anywhere else.

**Rotations:** this skill has no rotation findings, so it never reads or writes `.vibe-secure/rotations.json`. A leaked Stripe secret key or webhook secret is a `check-secrets` finding, and its rotation lives there.

### Stay in this area

Report only the three checks below. One root cause is one finding. If you notice any of these, mention it in one line of your reply, name the skill, and write no finding:

- a Stripe secret key (`sk_…`, `rk_…`) or webhook secret (`whsec_…`) in browser code, a `NEXT_PUBLIC_`/`VITE_` variable, a hard-coded string or git history → `check-secrets`. (A webhook secret in a public variable is also check 1 here, because it lets anyone sign fake events; the leak and its rotation stay with `check-secrets`.)
- a checkout, billing or customer-portal route with no login check, or one that trusts an app user id from the request → `check-auth`. Webhooks never need a login: their signature is their authentication. A Stripe **customer** id taken from the request (`customer: body.customerId`) is yours: check 3;
- the database rule or policy that lets users change their own `plan`, `credits` or `subscription_status` → `check-database-rules`. Your finding (check 3) is the app code that writes it from an untrusted source;
- SQL or HTML built from user input → `check-injection`; missing headers, CORS → `check-config`; an old `stripe` package version → `check-dependencies`.

## Finding the payment code

1. **Stripe calls:** search app code for `stripe.checkout.sessions.create`, `paymentIntents.create`, `subscriptions.create`, `invoiceItems.create`, `paymentLinks.create`, `prices.create`, `checkout.sessions.retrieve`, `webhooks.constructEvent`, `constructEventAsync`, and the Python forms (`stripe.checkout.Session.create`, `stripe.PaymentIntent.create`, `stripe.Webhook.construct_event`).
2. **Webhook handlers:** any handler that reads Stripe event types (`checkout.session.completed`, `invoice.paid`, `invoice.payment_succeeded`, `customer.subscription.`, `payment_intent.succeeded`, `event.type`, `event.data.object`) or the `stripe-signature` header, whatever its file name.
3. **Plan and credit writes:** writes of fields that say what someone paid for: `plan`, `tier`, `is_pro`, `is_premium`, `premium`, `paid`, `credits`, `balance`, `subscription_status`, `subscription_tier`, `stripe_price_id`, `order.status = 'paid'`, in browser code, routes, server actions and functions.
4. **Customer ids:** `customer:` / `customerId` arguments to `billingPortal.sessions.create`, `checkout.sessions.create` and `subscriptions.*`, and where their value comes from.
5. **Success pages:** the page or route named in `success_url`, and any page that reads `session_id`, `paid`, `success` or `plan` from the URL.

**Route paths (the subject for every check):** the path as callers use it, with dynamic parts as `:name`. Next.js App Router `app/api/billing/webhook/route.js` → `/api/billing/webhook` (route groups in parentheses are dropped); Pages Router `pages/api/x.js` → `/api/x`; a page `app/checkout/success/page.jsx` → `/checkout/success`; Express/Flask/FastAPI: the mount path plus the route path; SvelteKit `src/routes/api/x/+server.js` → `/api/x`; a server action → `action:<functionName>`; a Supabase Edge Function → `/functions/v1/<name>`; a Firebase or other cloud function → `fn:<exported name>`.

## Checks

### 1. `pay.webhook-unverified`: anyone can send your app a fake "payment succeeded"

**Subject:** the webhook route path (`/api/billing/webhook`, `/functions/v1/stripe-webhook`, `fn:stripeWebhook`).
**OWASP:** `A08:2025 Software or Data Integrity Failures`. **fix_risk:** `low`; `may_break`: the webhook needs the signing secret set where the app runs (say where, from `host`), and local testing needs `stripe listen`. Put "copy the signing secret into your server environment" in `manual_steps` when the app doesn't read one yet.

A webhook URL is public: anyone who finds it can post a made-up `checkout.session.completed`. Only Stripe's signature proves an event is real, and the signature is computed over the **exact raw bytes** of the body, so the check must run on the raw body before anything else uses it.

**It is unverified (report it) when any of these hold:**

1. **No check:** the handler never calls `stripe.webhooks.constructEvent` / `constructEventAsync` (Python `stripe.Webhook.construct_event`) before acting on the event, and doesn't re-fetch the event from Stripe instead (see "Not a finding"). Checking only that the `stripe-signature` header exists, or comparing it to a fixed string, is no check.
2. **Body used before the check:** the event the handler acts on comes from `await req.json()`, `JSON.parse(await req.text())`, `req.body`, `request.json` / `request.get_json()` rather than from the value `constructEvent` returns, even if `constructEvent` is also called somewhere.
3. **Failure doesn't stop it:** verification sits in a `try/catch` (or `try/except`) whose catch logs, ignores the error, or falls back to the parsed body and carries on, instead of returning a 400.
4. **Secret in a public variable:** the webhook secret is read from a browser-exposed variable (`NEXT_PUBLIC_…`, `VITE_…`, `REACT_APP_…`, `EXPO_PUBLIC_…`, `PUBLIC_…`). Whoever has the secret can sign their own events.
5. **Already-parsed body:** `constructEvent` gets a body the framework already turned into an object or re-serialised (`JSON.stringify(req.body)`, `req.body` in a Next.js **Pages Router** API route without `export const config = { api: { bodyParser: false } }`, or an Express route with `express.json()` / `bodyParser.json()` applied before it and no `express.raw({ type: 'application/json' })` on that route). Real Stripe events then always fail the check.
6. **Sync check on the edge:** an edge runtime calling `constructEvent` instead of `await stripe.webhooks.constructEventAsync(…)` with `Stripe.createSubtleCryptoProvider()`: a Supabase Edge Function, a Next.js route or middleware with `export const runtime = 'edge'`, a Vercel or Netlify Edge Function, a Deno or Cloudflare Worker. It throws on every real event.

**Confirm:** point at the handler line and the line that acts on the event (a database write, an email, granting access), and show which of 1–6 applies.

**Severity:** `critical` for cases 1–3, and for case 4 when browser code reads the secret (the secret ships to every visitor): anyone can mark orders paid or give themselves your product, with no skill. Case 4 when only server code reads the public variable → `high`; say in `impact` that one browser import would leak it. Cases 5 and 6 → `medium`: no fake event gets through today, but every real payment is rejected, and the usual "fix" people reach for is deleting the check; say so in `impact`.

If the unverified handler also grants the wrong thing (check 3's fulfilment rules), report that as its own check-3 finding at its own severity: it survives the signature fix. Don't rate it critical just because the webhook is unverified.

### 2. `pay.client-price`: buyers can set their own price

**Subject:** the route path of the checkout or payment route (`/api/orders/start`, `/api/create-payment-intent`), or `action:<functionName>`.
**OWASP:** `A08:2025 Software or Data Integrity Failures`. **fix_risk:** `low`; `may_break`: name the browser code that calls the route (`file:line`); it must send a product id instead of a price, and any product missing from the server catalog stops being sellable until it's added.

**Find it:** a Stripe create call (checkout session, PaymentIntent, subscription, invoice item, payment link, price) where any of these come from request data (body, query, form data, server-action arguments, callable `data`) without a server-side lookup:

- `amount`, `unit_amount`, `unit_amount_decimal`, or anything inside `price_data` that sets money (`unit_amount`, `recurring` together with an amount);
- a total computed from prices the browser sent (`items.reduce((sum, i) => sum + i.price * i.quantity, 0)`);
- `price` (a Stripe price id) passed straight through, not checked against a fixed list or looked up from a product id in your code or database;
- a total your code computes from a server-side price times a `quantity` from the request that isn't checked to be a whole number between 1 and a sensible maximum (a negative, zero or fractional quantity lowers the total, and can cancel out other items in a cart). A quantity passed as a Stripe line item's `quantity` is different: Stripe itself rejects anything below 1 or not whole;
- `discounts: [{ coupon: … }]` or `promotion_code` taken from the request without a check (any coupon in your account, including 100%-off ones, can be applied).

**Confirm:** trace the value from the request to the create call with no lookup in between. Follow helpers.

**Severity:** `high`. A buyer only needs to edit one request to pay what they like. If the route also grants something from the same request, that is check 3, a separate finding.

### 3. `pay.client-subscription-status`: people can give themselves a paid plan without paying

**Subject:** the route path or `action:<functionName>` that writes the plan, credits or paid status (the webhook route when the problem is in its fulfilment logic, the success page's path when that page grants access). When browser code writes it straight to the database, the **table** (or collection) name (`accounts`, `users`).
**OWASP:** `A08:2025 Software or Data Integrity Failures`. **fix_risk:** `high` for the critical cases (the grant moves to the webhook or to a server-side Stripe lookup), for revoking subscriptions (people who cancelled lose the plan) and for the customer-id case (the billing screens must stop sending it); `low` for the other webhook conditions (an extra check before granting). `may_break`: name the screens that set the plan today and say they'll now wait for Stripe to confirm. For the revocation fix, add that existing subscriptions need `account_id` metadata backfilled (or `stripe_customer_id` stored) before they sync.

A plan, credit balance or paid status may only be set from a **verified** Stripe event (check 1) or from data your server fetched from Stripe's API itself. Report it when:

| Case | Severity |
|---|---|
| Browser code writes the paid field to the database (Supabase `.update({ plan: … })`, Firestore `updateDoc`/`setDoc` with `plan`, `credits`, `isPro`), whether or not it runs after a checkout, **and** the database accepts that write (see "Is the browser write open?" below) | `critical`. Blocked → not a finding; can't tell → `unverified` |
| A route, server action or function sets the paid field from request data (`body.plan`, `body.credits`, `amount` added to a balance), or after a check the buyer controls | `critical` |
| A success page or route grants access from the URL: `?paid=true`, `?plan=pro`, or a `session_id` it never fetches from Stripe on the server (`stripe.checkout.sessions.retrieve`) and checks | `critical` |
| A success page fetches the session but doesn't check that it belongs to the signed-in user (its `client_reference_id`, `customer` or metadata user id), so any paid session id can be replayed for another account | `high` |
| A webhook (verified or not) grants a fixed plan for **any** completed checkout or payment, without checking which price or product was bought (the line items' `price.id`, a product id your server wrote into metadata and looks up again) | `high`: anyone who buys your cheapest item, or pays any other payment link in your Stripe account, gets the plan |
| A webhook takes the plan, the number of credits or the quantity to grant from metadata your checkout copied straight from the request (`metadata: { plan: body.plan }`, `metadata: { credits: body.credits }`) while the price was chosen separately | `high` |
| A webhook grants on the wrong event, or on any event: no `event.type` check at all, or a grant on an event that doesn't mean "paid" (`checkout.session.expired`, `payment_intent.created`, `payment_intent.payment_failed`, `invoice.created`, `customer.subscription.created` without checking `status` is `active` or `trialing`) | `high`: starting a checkout and walking away, or a failed card, is enough |
| A grant that **adds** credits, balance or uses (`credits + n`, an `increment`, an `insert` of a credit row) on the success page or in the webhook, without first recording the checkout session id or event id as used (a unique column or table checked in the same step) | `critical` when the user can repeat it (reloading the success page, re-sending its request); `medium` when only Stripe's own retries can repeat it (webhook) |
| A subscription-mode checkout grants a plan, but nothing takes it away: no handler for `customer.subscription.deleted`, none for `customer.subscription.updated` moving to `canceled`, `unpaid`, `past_due` (unless the app deliberately allows a `past_due` grace period) or `incomplete_expired`, and none for `invoice.payment_failed`. Also report it when those handlers set the plan from the event type alone instead of the subscription's `status` (or a fresh `stripe.subscriptions.retrieve`), because Stripe can deliver events out of order and an old "updated" event can re-grant | `high`: anyone can subscribe once, cancel or let the card fail, and keep the plan. Subject: the webhook route |
| A Stripe customer id taken from the request (`customer: body.customerId`, a `customerId` query parameter) in `billingPortal.sessions.create`, `checkout.sessions.create`, `subscriptions.create`/`update`/`cancel`, or `customers.retrieve`, instead of the customer id your server stored for the signed-in user | `high`: anyone who learns another customer's id (`cus_…`, shown in receipts and URLs) can open their billing portal, change or cancel their subscription, or see their invoices and card details. Subject: `customerId` |
| A `checkout.session.completed` handler grants without checking `session.payment_status === 'paid'` (or `'no_payment_required'` for free trials) | `medium`: delayed payment methods (bank debits, vouchers) complete the session before the money arrives, and may never pay |

One finding per subject: when one handler has several of these, use the worst severity and list every line in `evidence`.

Stripe-hosted Payment Links and the Pricing Table set the price in Stripe (not check 2), but the webhook that fulfils them is still checked here.

**Is the browser write open?** A browser write of a paid field is only a finding when the database lets it through. Read the rules for that table or collection:

- **Supabase:** open when RLS is off on the table, or an `update`/`insert` policy (or `all`) lets users write their own row and nothing protects the column. It is **blocked** when column grants leave the field out (`revoke update on <table> from authenticated` then `grant update (<other columns>) on <table> to authenticated`), a trigger rejects or resets changes to it, the policy's `with check` pins it to its current value, or there is no update/insert policy at all. A browser client built with the `service_role` key bypasses all of this, so it is open.
- **Firestore:** open when the rule for that document allows `update`/`create`/`write` without restricting fields. **Blocked** when the rule checks `request.resource.data.diff(resource.data).affectedKeys().hasOnly([...])` with a list that leaves the paid field out, or `!…affectedKeys().hasAny([...])` with a list that includes it, or pins it (`request.resource.data.plan == resource.data.plan`).
- **Can't find the rules** (no migrations, rules managed only in a dashboard) → `unverified`, under "worth a look": say what to check.

Blocked → write no finding and add an "already good" line ("Your app's browser code tries to set `plan`, but the database refuses it, so only your webhook can change it"); the browser code is dead weight, which you may mention. Open → `critical`, and say in `impact` that `check-database-rules` reports the rule itself.

**Confirm:** point at the line that writes the paid field and trace where its value and the decision to write it come from.

## Fixes

Read `references/payments-fixes.md` before writing any `fix_plan` or applying a fix. It has, per stack: verified webhooks for the Next.js App Router, the Pages Router, Express, Supabase Edge Functions and Python (Flask, FastAPI); a server-side price catalog or price-id allowlist for Checkout and PaymentIntents; fulfilment that checks the event type, the product bought and `payment_status` (plus `checkout.session.async_payment_succeeded`); one-time credit grants recorded by session id; subscription revocation from `subscription.status`; the customer id from your own records; a success page that verifies the session with Stripe; moving browser plan writes to the webhook; and where to find and set the webhook signing secret.

Before writing `may_break`, search for the callers of the code you will change (browser `fetch` calls to the route, forms, pages that set the plan) and name them with `file:line`.

## Not a finding

- Stripe publishable keys (`pk_live_…`, `pk_test_…`) in browser code: they are meant to be public.
- A **verified** webhook: `constructEvent(rawBody, signature, secret)` on `await req.text()` (App Router), on a raw buffer with `bodyParser: false` (Pages Router), on `express.raw({ type: 'application/json' })` (Express), `await constructEventAsync(…)` in Edge Functions, `construct_event(request.data / await request.body(), …)` in Python, with a failed check returning 400 before anything else happens.
- A webhook that ignores the body and re-fetches the event from Stripe (`stripe.events.retrieve(event.id)`) and acts only on what Stripe returns.
- A price id from the browser checked against a server allowlist (a fixed map or list, or a product row looked up by id); amounts from a server-side catalog or database lookup; `quantity` from the browser passed as a Stripe line item's `quantity` with a server-chosen price (Stripe rejects quantities below 1 or not whole). A quantity your own code multiplies into an amount is check 2 unless it is validated.
- Metadata your server wrote at checkout from a server-side lookup (a product id it then looks up again in the webhook), read back from a verified event; the user id in `client_reference_id` taken from the verified session at checkout.
- Prices of Stripe-hosted pricing (Payment Links, the Pricing Table) and the Customer Portal opened for the customer id your server stored: prices are set in the Stripe dashboard. Their fulfilment is still check 3.
- A success page that only shows a "thanks" message and grants nothing.
- No deduplication of webhook event ids when the grant **sets** a fixed value (a replayed event changes nothing). Grants that add credits are check 3.
- Reading the plan to show or hide things in the UI, when the server or rules enforce it.
- Test files, Stripe CLI fixtures, seed scripts, and anything under the excluded paths.

## What's already good

Collect lines like these, only for things you actually checked: "Your Stripe webhook checks Stripe's signature on the raw body before doing anything", "Your checkout looks up each price on the server, so buyers can't change it", "Plans are only granted by the verified webhook, after Stripe says the payment is paid", "Your webhook grants only the plan that matches the product bought", "Your success page asks Stripe whether the session was paid before showing access", "Your webhook signing secret is only read in server code", "Each checkout adds credits only once, even if the page is reloaded", "Cancelled or unpaid subscriptions lose the paid plan", "Your billing portal uses the customer id stored for the signed-in user", "The Stripe key in the browser is the publishable key, which is meant to be public".

## Findings file

`.vibe-secure/findings/payments.json`. The whole file, every time (with `"findings": []` when nothing is wrong). `generated_at` comes from `node -e "console.log(new Date().toISOString())"`:

```json
{ "area": "payments", "generated_at": "<output of that command>", "mode": "audit", "findings": [ … ] }
```

Ids are `payments-1`, `payments-2`, … in this run. Example of one finding (illustrative values):

```json
{
  "id": "payments-1",
  "check": "pay.webhook-unverified",
  "subject": "/api/billing/webhook",
  "area": "payments",
  "owasp": "A08:2025 Software or Data Integrity Failures",
  "severity": "critical",
  "title": "Anyone can mark their order as paid without paying",
  "impact": "Your billing webhook believes any request that looks like a Stripe event. It never checks Stripe's signature, so a stranger can post a fake \"checkout completed\" message to this public URL and your app will mark their order paid and ship it.",
  "evidence": [
    { "file": "src/app/api/billing/webhook/route.ts", "line": 6 },
    { "file": "src/app/api/billing/webhook/route.ts", "line": 9 }
  ],
  "fix_plan": "Read the raw body with req.text() and check it with stripe.webhooks.constructEvent and your webhook signing secret. Return 400 when the check fails, and use only the event it returns.",
  "fix_risk": { "level": "low", "may_break": "Real Stripe events keep working once STRIPE_WEBHOOK_SECRET is set in your Vercel environment variables. Fake or test requests sent without a signature will be rejected." },
  "manual_steps": [
    "Open dashboard.stripe.com → Developers → Webhooks, select this endpoint and reveal its signing secret (it starts with whsec_).",
    "Add it as STRIPE_WEBHOOK_SECRET (no NEXT_PUBLIC_ prefix) in your host's environment variables and in .env.local, then redeploy."
  ],
  "status": "open"
}
```
