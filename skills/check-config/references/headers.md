# Security headers: ready-to-paste blocks

Use the block for the file named in the finding's `subject`. Every block sets the same headers:

| Header | What it does | Risk of adding it |
|---|---|---|
| `Content-Security-Policy-Report-Only` | Lists where scripts, styles, images and connections may come from. In report-only mode the browser only reports what it *would* block and blocks nothing | `high` once enforced: may block scripts from other sites |
| `X-Frame-Options: DENY` | Stops other sites from showing your pages inside a frame (clickjacking) | low: your own pages can't be framed either; use `SAMEORIGIN` if you frame yourself |
| `Strict-Transport-Security` | Makes browsers always use HTTPS on your domain | low: browsers refuse plain `http://` on the domain (and subdomains with `includeSubDomains`) for `max-age` seconds |
| `X-Content-Type-Options: nosniff` | Stops browsers from guessing file types | low |
| `Referrer-Policy: strict-origin-when-cross-origin` | Sends only your domain, not full URLs, to other sites | low |

Notes:

- **Start CSP in report-only mode.** Browsers ignore `frame-ancestors` in report-only mode, which is why `X-Frame-Options` is always set too. After a week with no unexpected reports in the browser console (or at a report endpoint), rename the header to `Content-Security-Policy`.
- **Fill in the CSP sources** from the code: every outside script (analytics, Stripe `https://js.stripe.com`, chat widgets), API host (`https://<project>.supabase.co`, `wss://<project>.supabase.co` for Realtime), font and image host the app uses. Search the code for `https://` in `<script src>`, `fetch(` and SDK URLs before writing it.
- **Next.js** inlines small scripts, so its starter policy needs `'unsafe-inline'` in `script-src` until you move to nonces (see the Next.js docs on CSP with `middleware`). `next dev` also needs `'unsafe-eval'`; add it only when `process.env.NODE_ENV === 'development'`.
- **Don't add `preload` to HSTS** unless the user asks: it's hard to undo.
- **Vercel and Netlify** add HSTS for you; leave it out there.
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
          { "key": "Content-Security-Policy-Report-Only", "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
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

Merge `headers` into the existing `hosting` object; keep `public`, `rewrites` and the rest.

## Vite app with no host config (`vite.config.*`)

Vite's config only sets headers for the development server, so production headers have to come from the host. Tell the user which file to add for their host (above), and add a CSP meta tag to `index.html` meanwhile (meta tags can't set `frame-ancestors`, `X-Frame-Options` or HSTS):

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'self'">
```

A meta CSP is enforced right away (there's no report-only meta tag), so this is the `fix_risk: high` step: test every page after adding it.

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
X_FRAME_OPTIONS = "DENY"
SECURE_HSTS_SECONDS = 63072000          # set only when the site is served over HTTPS
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
```

For CSP, use `django-csp` (`pip install django-csp`, add `csp.middleware.CSPMiddleware`) with `CSP_REPORT_ONLY = True` (django-csp 3.x) or `CONTENT_SECURITY_POLICY_REPORT_ONLY = { "DIRECTIVES": { … } }` (django-csp 4.x), matching the version installed.

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
      },
    },
  },
};
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
