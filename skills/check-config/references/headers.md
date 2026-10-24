# Security headers: ready-to-paste blocks

Use the block for the file named in the finding's `subject`. Every block sets the same headers:

| Header | What it does | Risk of adding it |
|---|---|---|
| `Content-Security-Policy-Report-Only` | Lists where scripts, styles, images and connections may come from. In report-only mode the browser only reports what it *would* block and blocks nothing | `high` once enforced: anything not listed stops working: scripts from other sites, API and realtime calls to other hosts (`connect-src`), embedded frames such as Stripe Elements, 3-D Secure, YouTube or the Firebase Auth sign-in frame (`frame-src`, which falls back to `default-src`), and forms whose submission ends up on another site, including a POST your server answers with a redirect to Stripe Checkout or an OAuth provider (`form-action`) |
| `X-Frame-Options: DENY` | Stops other sites from showing your pages inside a frame (clickjacking) | low: your own pages can't be framed either (use `SAMEORIGIN` if you frame yourself), and embeds on other sites break: if the app is meant to be embedded (an `/embed` route, a Shopify app, customers pasting an iframe), use `frame-ancestors` with the allowed sites instead |
| `Strict-Transport-Security` | Makes browsers always use HTTPS on your domain | low: browsers refuse plain `http://` on the domain (and subdomains with `includeSubDomains`) for `max-age` seconds |
| `X-Content-Type-Options: nosniff` | Stops browsers from guessing file types | low |
| `Referrer-Policy: strict-origin-when-cross-origin` | Sends only your domain, not full URLs, to other sites | low |

Notes:

- **Start CSP in report-only mode.** Browsers ignore `frame-ancestors` in report-only mode, which is why `X-Frame-Options` is always set too. Never add an enforced CSP as a first step, on any stack.
- **Switching to enforced** is a manual step for the user: deploy the report-only header, then open every page and every flow (sign-up, sign-in, password reset, checkout and its 3-D Secure screen, file uploads, embeds) with the browser's DevTools console open and look for "Content-Security-Policy-Report-Only" violation messages; or add a report endpoint (`report-uri /csp-report`) and read what it collects. Add each legitimate host it shows, then rename the header to `Content-Security-Policy`. On Vercel preview deployments, the Vercel toolbar (`vercel.live`) shows up as violations: ignore those, or test on the production domain.
- **Fill in the CSP sources from the code before writing the policy.** Search for the clients and URLs the app uses and add each host to its directive:
  - `connect-src`: API and realtime hosts: Supabase `https://<project>.supabase.co wss://<project>.supabase.co`; Firebase `https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com`; Stripe `https://api.stripe.com`; your own API on another domain; analytics collectors.
  - `script-src`: Stripe `https://js.stripe.com`; Firebase Auth with Google sign-in `https://apis.google.com`; analytics and chat widget scripts.
  - `frame-src`: Stripe Elements and 3-D Secure `https://js.stripe.com https://hooks.stripe.com`; Firebase Auth's sign-in frame `https://<project>.firebaseapp.com` (the `authDomain` in the Firebase config); YouTube `https://www.youtube.com`; maps.
  - `form-action`: a form whose submission ends up on another site — including when your server redirects after the POST (Stripe Checkout, OAuth sign-in) — needs that host in `form-action`; client-side JS redirects (`window.location`, `router.push`) don't. Examples: Stripe Checkout `https://checkout.stripe.com` (a form that posts to your `/create-checkout-session` route, which answers with a 303 redirect there), an OAuth provider's sign-in host (Auth.js sign-in forms post to your app and are redirected to the provider).
- **Next.js** inlines small scripts, so its starter policy needs `'unsafe-inline'` in `script-src` until you move to nonces (see the Next.js docs on CSP with `middleware`). `next dev` also needs `'unsafe-eval'`; add it only when `process.env.NODE_ENV === 'development'`.
- HSTS rules (no `preload`, none on Vercel or Netlify) are in the skill's Fixes section.
- If the app already sets some headers, add only the missing ones and keep the existing values.

## Starter CSP value

```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
```

Add each outside host to the right directive (`connect-src 'self' https://abc.supabase.co wss://abc.supabase.co`, `script-src 'self' 'unsafe-inline' https://js.stripe.com`, `frame-src https://js.stripe.com`). A plain single-page app built by Vite has no inline scripts, so drop `'unsafe-inline'` from `script-src` there.

## Next.js (`next.config.js` / `.mjs` / `.ts`)

```js
const securityHeaders = [
  { key: 'Content-Security-Policy-Report-Only', value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

export default {
  // ...keep the existing settings...
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};
```

Use `module.exports = { … }` if the file uses CommonJS. If `headers()` already exists, add these entries to its `/(.*)` rule (or add that rule) instead of writing a second function. On Vercel or Netlify, drop the HSTS line.

## Vercel (`vercel.json`)

For apps Vercel serves as static files or with functions, when the framework has no headers setting of its own:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy-Report-Only", "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

Merge into the existing file's `headers` array; keep its other keys.

## Netlify (`netlify.toml`)

```toml
[[headers]]
  for = "/*"
  [headers.values]
    Content-Security-Policy-Report-Only = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
```

## `_headers` (Netlify, Cloudflare Pages)

The file goes in the folder that gets published (for Vite, `public/_headers`, which is copied to `dist/`):

```
/*
  Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
  X-Frame-Options: DENY
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
```

On Netlify, drop the HSTS line (Netlify adds it).

## Firebase Hosting (`firebase.json`)

```json
{
  "hosting": {
    "headers": [
      {
        "source": "**",
        "headers": [
          { "key": "Content-Security-Policy-Report-Only", "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com; frame-src https://<project>.firebaseapp.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
          { "key": "X-Frame-Options", "value": "DENY" },
          { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains" },
          { "key": "X-Content-Type-Options", "value": "nosniff" },
          { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
        ]
      }
    ]
  }
}
```

Merge `headers` into the existing `hosting` object; keep `public`, `rewrites` and the rest. Replace `<project>` with the project's `authDomain`; with Google sign-in, add `https://apis.google.com` to `script-src`.

## Vite or other static app

Vite's config only sets headers for the development server, so production headers come from the host. Use the block above for the host in `stack.json` (`vercel.json`, `netlify.toml` or `public/_headers`, `firebase.json`), creating the file if it doesn't exist. When the host is `unknown`, don't change any file: put the headers in `manual_steps` ("Add these headers in your host's settings: …", with the report-only CSP and the rollout steps). Don't add a `<meta>` CSP: it can't be report-only, so it would block things right away.

## Express (`helmet`)

```js
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    reportOnly: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  frameguard: { action: 'deny' },
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: false },
}));
```

Put it before the routes. `npm install helmet`.

## Flask (`app.py`)

No extra package:

```python
@app.after_request
def set_security_headers(response):
    response.headers.setdefault(
        "Content-Security-Policy-Report-Only",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; "
        "base-uri 'self'; form-action 'self'; object-src 'none'",
    )
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return response
```

(Flask-Talisman does the same, but it also forces HTTPS redirects, which breaks local `http://` testing unless configured.)

## Django (`settings.py`)

```python
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # ...the rest...
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
SECURE_HSTS_SECONDS = 63072000          # set only when the site is served over HTTPS
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
```

Keep Django's own defaults: `X_FRAME_OPTIONS = "DENY"`, `SECURE_CONTENT_TYPE_NOSNIFF = True` and `SECURE_REFERRER_POLICY = "same-origin"` are already set unless the settings file overrides them; don't loosen them.

For CSP on Django 6.0 or later, use the built-in setting: add `"django.middleware.csp.ContentSecurityPolicyMiddleware"` to `MIDDLEWARE` and set `SECURE_CSP_REPORT_ONLY = {"default-src": [CSP.SELF], "object-src": [CSP.NONE], "base-uri": [CSP.SELF]}` (`from django.utils.csp import CSP`), adding the hosts the app uses. On older versions, use `django-csp` (`pip install django-csp`, add `csp.middleware.CSPMiddleware`) with `CSP_REPORT_ONLY = True` (django-csp 3.x) or `CONTENT_SECURITY_POLICY_REPORT_ONLY = { "DIRECTIVES": { … } }` (django-csp 4.x), matching the version installed.

## SvelteKit (`svelte.config.js`)

```js
const config = {
  kit: {
    csp: {
      mode: 'auto',
      reportOnly: {
        'default-src': ['self'],
        'script-src': ['self'],
        'style-src': ['self', 'unsafe-inline'],
        'img-src': ['self', 'data:', 'https:'],
        'connect-src': ['self'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'report-uri': ['/csp-report'],
      },
    },
  },
};
```

SvelteKit refuses to start with a `reportOnly` policy that has no `report-uri` or `report-to`, so add the tiny endpoint it reports to, `src/routes/csp-report/+server.js`:

```js
export async function POST({ request }) {
  console.warn('CSP report', await request.text());
  return new Response(null, { status: 204 });
}
```

Set `X-Frame-Options` and HSTS in `src/hooks.server.js`:

```js
export async function handle({ event, resolve }) {
  const response = await resolve(event);
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
}
```
