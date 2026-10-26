---
name: check-config
description: Use when auditing an app's configuration for holes, such as missing security headers (Content-Security-Policy, X-Frame-Options, HSTS), CORS that lets any site call your API with the visitor's cookies, debug mode or stack traces and raw error messages reaching visitors, secrets or tokens written to logs, and source maps published with the production site.
disable-model-invocation: true
---

# Check config

## What this protects against

Your app's settings decide how much a browser trusts it, which other sites may call it, and what it says when something goes wrong. Wrong settings don't usually hand over data on their own, but they make other attacks much easier: a missing header lets another site frame your pages or lets an injected script run freely, loose CORS lets any website act as your signed-in visitor, and debug pages, raw error messages and chatty logs tell an attacker how your app is built (or, with an interactive debugger, let them run code on your server).

OWASP Top 10 (2025): `A02:2025 Security Misconfiguration` for `cfg.cors-wildcard-credentials`, `cfg.missing-headers`, `cfg.public-source-maps` and debug settings in `cfg.debug-in-prod`; `A10:2025 Mishandling of Exceptional Conditions` for error details sent to visitors; `A09:2025 Logging & Alerting Failures` for secrets and tokens written to logs.

## Applies when

Always, for every app in `stack.json`, including apps whose framework is `unknown` (Python, plain Node). Header and source-map details depend on the framework and `host`; when an app's stack isn't recognised, run the code checks (CORS, debug, error replies, logging) anyway, look for headers in whatever server code exists, and say in the report which framework-specific checks were skipped.

## How to run

Follow the run contract in `<root>/shared/area-skill-template.md` (Part 2). In short:

- `<root>` = two levels up from this skill's base directory (or `Plugin root:` in a dispatch prompt). Project root = the current directory, or the `Project root:` from a dispatch prompt. In that case, use that path wherever a command below says `.`.
- **Mode:** `audit` unless the request says `verify <check> <subject>`.
- **Time stamps:** `node -e "console.log(new Date().toISOString())"`. Never guess.
- **Alone, audit:** `node <root>/scripts/init-workspace.mjs .`, then `node <root>/scripts/detect-stack.mjs .` if `.vibe-secure/stack.json` is missing → run the checks → write `.vibe-secure/findings/config.json` (always, `"findings": []` when clean) → `node <root>/scripts/validate-findings.mjs .vibe-secure/findings/config.json` until it passes → follow `<root>/shared/report-and-fix.md` (if the user asked for a report only, still run `merge-findings`, show the report and save it to `.vibe-secure/report-config.md`; then stop).
- **`dispatched: audit`:** run the checks, write and validate the file, reply with counts, "already good" lines and skipped checks. No report, no fix loop.
- **`verify <check> <subject>`:** no init or detect-stack (read `stack.json`, `package.json` or the Python manifest directly); re-run that one check for that subject, reply `PRESENT` or `GONE` plus evidence, write nothing.
- **Dispatched project root:** substitute it for `.` in every command.
- **Search scope:** never look inside `node_modules`, `.next`, `dist`, `build`, `out`, `.vercel`, `.vibe-secure`, `*.min.js` or lockfiles.
- **Commands:** one plain command per Bash call: no `&&`, `;`, `||`, `$?`, `$(…)`, `{…}` or pipes into other programs, because those need extra approval and may be refused. Use the Read and Grep tools for files. Don't write helper scripts or scratch files, in the project or anywhere else.

**Rotations:** this skill has no rotation findings, so it never reads or writes `.vibe-secure/rotations.json`. If a log line prints a real key, the key's rotation belongs to `check-secrets`; say so in one line.

### Stay in this area

Report only the four checks below. One root cause is one finding: `debug=True` that also shows stack traces is one finding, not a "debug" finding plus an "error handling" finding. If you notice any of these, mention it in one line of your reply, name the skill, and write no finding:

- keys, passwords or `SECRET_KEY` values written in code or committed `.env` files, `.env` not gitignored → `check-secrets`;
- tables with RLS off, open Firestore or Storage rules → `check-database-rules`;
- routes with no login check, cookies without `httpOnly`/`secure`/`sameSite`, no rate limit on login, an auth check that lets the request through when it throws → `check-auth`;
- SQL, HTML or shell built from user input → `check-injection`; webhooks and prices → `check-payments`; AI routes → `check-ai-features`;
- old framework or library versions → `check-dependencies`;
- what the deployed site actually sends (headers, `/.env`, `/.git`, live stack traces) → `check-live`, which confirms your findings with the same check ids.

## Checks

### 1. `cfg.cors-wildcard-credentials`: any website can call your API as your signed-in visitor

**Subject:** where the CORS setting lives. For a header set by one API route, the route path as callers use it (`/api/account`; App Router `app/api/account/route.js` → `/api/account`, Pages Router `pages/api/x.js` → `/api/x`, a Supabase Edge Function → `/functions/v1/<name>`). For a setting that covers the whole app (`app.use(cors(…))`, `CORS(app, …)`, a `headers` block for every path), the file name it's in: `server.js`, `app.py`, `settings.py`, `next.config.js`, `vercel.json`, `netlify.toml`, `_headers`, `firebase.json`. One finding per subject.
**OWASP:** `A02:2025 Security Misconfiguration`. **fix_risk:** `high` (it changes which sites can call your API). `may_break`: a separate frontend on another domain (or a mobile web view, a partner site) stops getting answers until its address is on the allowlist.

**Find it:** search app code and config for `Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials`, `cors(`, `CORS(`, `CORSMiddleware`, `CORS_ALLOW_ALL_ORIGINS`, `CORS_ORIGIN_ALLOW_ALL`, `CORS_ALLOWED_ORIGIN_REGEXES`, `corsHeaders`, `allow_origins`, `supports_credentials`. A finding needs both halves:

- **Any origin:** the allowed origin is `*`, or it echoes whatever origin the request names: `req.headers.origin` / `request.headers.get('origin')` copied into `Access-Control-Allow-Origin` without checking it against a list; `cors({ origin: true })`; `origin: (origin, cb) => cb(null, true)`; an origin regex that matches any host (`/.*/`) or checks with `includes`/`endsWith('yourapp.com')` without a leading dot or scheme (so `evil-yourapp.com` passes); Flask-CORS with default or `*` origins and `supports_credentials=True` (it echoes the origin); FastAPI/Starlette `allow_origins=["*"]` with `allow_credentials=True` (it echoes the origin too); Django `CORS_ALLOW_ALL_ORIGINS = True` (or `CORS_ORIGIN_ALLOW_ALL`). An allowlist that contains `'null'` also counts as any origin: sandboxed iframes and `data:` pages send `Origin: null`, and any site can create one.
- **With credentials:** `Access-Control-Allow-Credentials: true`, `credentials: true`, `supports_credentials=True`, `allow_credentials=True`, `CORS_ALLOW_CREDENTIALS = True`.

**Confirm:** you can point at the line that allows any origin and the line that allows credentials, and they apply to the same responses. Then find **how those routes authenticate the caller** (see "How to tell whether a login is checked" in `<root>/skills/check-auth/SKILL.md`): a session cookie the browser sends by itself (Auth.js, iron-session, Lucia, `@supabase/ssr` cookies, Flask/Django sessions, `express-session`), or only a token the frontend puts in the `Authorization` header. For a cookie, find where it's set (the auth library's cookie options, `res.cookie(…)`, `cookies().set(…)`, `SESSION_COOKIE_SAMESITE`, `SameSite=` in a `Set-Cookie`) and read its `SameSite` value; library defaults count (Auth.js, `@supabase/ssr` and Django use `Lax`).

**Severity:**

| How the API knows who's calling | Severity |
|---|---|
| A cookie with `SameSite=None`, or with no `SameSite` attribute set anywhere | `high`: any website a signed-in visitor opens can call your API with their cookies and read the answers (their profile, their data, anything the API returns) |
| A cookie explicitly `SameSite=Lax` or `Strict` (set in code or by the library's default) | `medium`: browsers don't send that cookie on another site's background requests today, but sibling subdomains still count as the same site, and the setting is one change away from opening the hole |
| Only an `Authorization` header token (no auth cookie) | not a finding: other sites can't read the visitor's token, so they can't call the API as them |

When the header is a literal `*` with credentials (and the cookie row says `high`), it stays `high`: browsers refuse that combination today, so logged-in cross-site calls are failing already, and the usual quick "fix" for that error is echoing the origin, which opens the hole. Say both in `impact`.

### 2. `cfg.missing-headers`: your pages are missing the browser's safety settings

**Subject:** the config file you'd add the headers to, with its real name and path from the project root if not at the root: an existing headers file first (`vercel.json`, `netlify.toml`, `_headers` / `public/_headers`, `firebase.json`, `next.config.js` / `next.config.mjs` / `next.config.ts` with a `headers()` function); otherwise the framework's config or server file: `next.config.js` (whichever `next.config.*` exists) for Next.js, the file that creates the server (`server.js`, `app.js`, `index.ts`) for Express, `app.py` (the file that creates the Flask app) for Flask, `settings.py` for Django, `svelte.config.js` for SvelteKit. A Vite (or other static single-page) app: the host's header file from `stack.json` `host` (`vercel.json` for `vercel`, `netlify.toml` for `netlify`, `firebase.json` for `firebase`), even if that file doesn't exist yet; `vite.config.ts` / `vite.config.js` only when the host is `unknown`. One finding per app.
**OWASP:** `A02:2025 Security Misconfiguration`. **fix_risk:**

- `high` when `Content-Security-Policy` is among the missing headers. The CSP starts as `Content-Security-Policy-Report-Only`, which blocks nothing, but once it is enforced, anything the policy doesn't list stops working. `may_break` names the categories, with the ones you found in this app's code (`file:line`): scripts from other sites (analytics, chat widgets, Stripe.js, Google sign-in); API and realtime calls to other hosts (Supabase, Firebase, Stripe, your own API on another domain: `connect-src`); embedded frames (Stripe Elements and 3-D Secure, YouTube or map embeds, the Firebase Auth sign-in frame: `frame-src`, which falls back to `default-src`); and forms whose submission ends up on another site, including a POST your server answers with a redirect to Stripe Checkout or an OAuth sign-in page (`form-action`; client-side JS redirects such as `window.location` or `router.push` aren't affected).
- `low` when only `X-Frame-Options` / `frame-ancestors` and HSTS are missing. `may_break`: other sites can no longer show your pages inside an iframe, and HSTS makes browsers refuse plain `http://` on your domain for the length of `max-age`.

**Embedding on purpose:** before proposing `X-Frame-Options: DENY` or `frame-ancestors 'none'`, look for signs the app is meant to be shown inside other sites: an `/embed` or `/widget` route, Shopify App Bridge (`@shopify/app-bridge`) or another platform's embedded-app SDK, an `<iframe src=` snippet in docs, a README or a settings page telling customers to paste it into their site. If you find any, name it in `may_break`, and the fix uses `frame-ancestors` listing the allowed sites (for example `https://*.myshopify.com https://admin.shopify.com`) for those routes instead of blocking all framing.

**Find it:** look for the three headers everywhere they can be set for the app:

- **Next.js:** `async headers()` in `next.config.*`; `middleware.ts`/`.js` (or `proxy.ts`) setting `response.headers.set(…)`, including nonce-based CSP.
- **Host config:** `vercel.json` `"headers"`; `netlify.toml` `[[headers]]`; `_headers` (Netlify, Cloudflare Pages: in the folder that gets published, often `public/`); `firebase.json` `hosting.headers`.
- **Server code:** Express `helmet()` (it sets all three by default unless options turn them off: `contentSecurityPolicy: false`, `frameguard: false`, `hsts: false`), `res.setHeader(…)` middleware for every route; Flask-Talisman `Talisman(app)`, an `@app.after_request` that sets them; Django `SECURE_HSTS_SECONDS` > 0, `XFrameOptionsMiddleware` in `MIDDLEWARE` (sends `X-Frame-Options: DENY` by default), a CSP from `django-csp` or Django's built-in CSP settings; SvelteKit `kit.csp` in `svelte.config.js` or `setHeaders` in `hooks.server.*`; Remix/other servers: headers set on every response in the entry server file.
- **HTML:** a `<meta http-equiv="Content-Security-Policy">` in `index.html` or the root layout counts for CSP only (browsers ignore `frame-ancestors` in a meta tag).

Then decide, per app, which of these is missing:

- **Content-Security-Policy:** no `Content-Security-Policy` header or meta tag for the pages. A `Content-Security-Policy-Report-Only` alone means it's still being tested: not missing, but mention it under "worth a look".
- **Clickjacking protection:** neither `X-Frame-Options` (`DENY` or `SAMEORIGIN`) nor a CSP header with `frame-ancestors`.
- **Strict-Transport-Security (HSTS):** no HSTS header. **Hosting defaults count:** Vercel and Netlify send HSTS for every site they serve, so on `host: vercel` or `host: netlify` missing HSTS is not missing. An API-only app (no pages, only JSON) needs HSTS but not CSP or clickjacking protection.

The headers must apply to the app's pages: a `source` that covers only one path or only `/api` doesn't count for the rest. `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy` don't make a finding on their own; when the finding exists, include them in the fix.

**Confirm:** you looked in every place listed for that stack and the host, and you can point at the file the headers belong in (a line in it as evidence: the config's export or the line that creates the app or server).

**Severity:** `low`. `medium` when the app has a login (users sign in, so a framed page or an injected script can act inside a signed-in session): search app code for Supabase `auth.signIn…`/`auth.getUser`, Auth.js/NextAuth, Clerk, Firebase Auth, Lucia, Passport, Flask-Login, Django auth, or a login route that sets a session cookie. In `impact`, list exactly which headers are missing and what each does, in plain words (CSP: limits which scripts can run, so an injected script has a harder time; clickjacking protection: stops other sites from showing your pages in a hidden frame to trick clicks; HSTS: makes browsers always use HTTPS).

### 3. `cfg.debug-in-prod`: your app shows its insides when something goes wrong

**Subject**, by case:

- a debug setting: the setting exactly as written in the code, bare: `debug=True` (from `app.run(port=8000, debug=True)`), `DEBUG = True`, `app.debug = True`, `FLASK_DEBUG=1`, `NODE_ENV !== 'development'`, `introspection: true`. Paths go in `evidence`;
- a debug or test route: the route path (`/api/debug`, `/api/test-env`);
- error details sent to visitors from one route: the route path as callers use it (`/api/orders`, `/functions/v1/send-invite`, `action:saveProfile` for a server action); from an app-wide error handler: the file name it's in (`server.js`, `app.py`);
- secrets in logs: the route path when one route logs them, otherwise the file name.

One finding per subject.
**OWASP:** `A02:2025 Security Misconfiguration` for debug settings; `A10:2025 Mishandling of Exceptional Conditions` for error details sent to visitors; `A09:2025 Logging & Alerting Failures` for secrets in logs. **fix_risk:** `low` (`may_break`: visitors and your own frontend see a short generic error instead of the detailed message; if your frontend shows the server's error text to users, name that file and line).

**Find it:**

- **Debug settings left on:** Flask `app.run(debug=True)`, `app.debug = True`, `app.config["DEBUG"] = True`, `FLASK_DEBUG=1` / `FLASK_ENV=development` in a committed `.flaskenv` or Dockerfile/Procfile; Django `DEBUG = True` in the settings file that runs in production; FastAPI/Starlette `debug=True`; `uvicorn … --reload` or `flask run --debug` in a Dockerfile, Procfile or start script. A `debug=True` hard-coded in `app.run` counts even inside `if __name__ == "__main__":`, because many hosts start the app with `python app.py`. Read the value: `debug=os.environ.get("FLASK_DEBUG") == "1"` or `DEBUG = env.bool("DEBUG", default=False)` is gated by the environment and is not a finding; a default of `True` (`os.getenv("DEBUG", "True")`) is.
- **Inverted environment checks:** details shown in production because the check points the wrong way or reads a variable that isn't set there. `if (process.env.NODE_ENV !== 'production') { send the stack }` is fine on Vercel, Netlify and other hosts that set `NODE_ENV=production`; it is a finding only when the app's own start command or host config shows `NODE_ENV` is unset in production (a plain `node server.js` on a VPS or container with no `NODE_ENV`). The real bugs are a check that is inverted (`NODE_ENV !== 'development'` or `=== 'production'` guarding the detailed branch), `if (!isProd)` where `isProd` reads a variable nothing sets, and a debug page enabled when an env variable is *missing*.
- **Debug and test routes:** routes such as `/api/debug`, `/api/test`, `/api/env`, `/api/health` that return `process.env`, `os.environ`, `app.config`, `settings`, a config object or a dump of headers and environment. Subject: the route path.
- **GraphQL left in development mode:** Apollo Server `introspection: true` or a playground/sandbox (`ApolloServerPluginLandingPageLocalDefault`, `graphiql: true`, GraphQL Yoga `graphiql`, Strawberry `graphql_ide`, Graphene `graphiql=True`) with no environment check, so production lists every type and field to anyone. Apollo turns introspection off by itself when `NODE_ENV=production`, so only an explicit `true` (or a playground forced on) counts.
- **Error details sent to visitors:** a server response (route handler, API route, server action return value, Express/Flask/FastAPI handler, Edge Function) that includes `err.stack`, `error.stack`, `traceback.format_exc()`, the raw exception object (`res.json(err)`, `res.status(500).send(err)`, `jsonify(error=str(e))`, `return { error }` with a database error object), or `error.message` / `err.message` / `str(e)` from a database, ORM, provider SDK or internal call. Database messages are the main case: a Supabase query's (PostgREST) `error.message`, Prisma, Drizzle, `pg` or SQLAlchemy errors name your tables, columns, constraints and row level security policies. Two kinds of message are written for end users and are not findings: Supabase **Auth** errors (`error.message` after `auth.signInWithPassword`, `signUp`, `resetPasswordForEmail`, `verifyOtp`; whether they reveal which emails have accounts is `check-auth`'s question), and validation errors from zod, yup, joi or valibot (`parsed.error.issues`, `error.flatten()`, `err.details`). Express error middleware (`(err, req, res, next) =>`) that sends `err.stack` or `err.message`. Follow the value: `return Response.json({ error: 'Something went wrong' })` after logging the error is the safe pattern.
- **Secrets in logs:** server-side `console.log`/`console.info`/`logger.*`/`print`/`logging.*` of a whole request's headers (`req.headers`, `request.headers`, which carry cookies and `Authorization`), the `Authorization` or `Cookie` header itself, a session or access token, a password field or a login request's whole body, a webhook secret or API key value, or a full session object. Hosts keep these logs, and anyone with log access (teammates, log services, a leaked log export) can sign in as your users.

**Confirm:** you can point at the setting line, or at the line where the error detail goes into the response (and the line where the error comes from), or at the log line and what it prints.

**Severity:** `medium`, raised as follows:

- `high` when the Werkzeug interactive debugger is reachable from other machines: Flask debug on (any form above) **and** the server listens on all interfaces (`host="0.0.0.0"`, `--host=0.0.0.0`, `flask run --host 0.0.0.0`, or a Dockerfile/Procfile that starts it that way). On any error, its in-browser console runs Python on your server for whoever has the PIN, and the PIN can be worked out by someone who can read a few files on the server. Say this in `impact`, and keep the title honest: the PIN is what stands in the way ("Your app exposes a debugger console that can run code on your server"), not "anyone can run code".
- `critical` when a debug console or database admin UI is served publicly with no login: the Werkzeug debugger with the PIN turned off (`WERKZEUG_DEBUG_PIN=off`), Prisma Studio, Adminer, phpMyAdmin, or a `/debug`, `/console` or `/admin/sql` route that runs code or queries with no login check. Also `critical`: a debug or test route with no login that returns environment variables or config containing secrets (keys, database URLs, signing secrets); mask any value you quote, and say in one line that `check-secrets` covers rotating them. Such a route that returns only non-secret values is `medium`.
- `medium` for everything else: GraphQL introspection or a playground left on in production (it hands out a map of every query and field), Django or Flask debug pages (they show your code, settings and URL list), stack traces and raw error messages (they show table and column names, file paths and library versions), and secrets or tokens in logs.

When debug mode is on and the same app also returns raw error messages, those are separate subjects (the setting and the route) and separate findings only if the route's code sends the detail itself; error pages that only appear *because of* debug mode belong to the debug finding.

### 4. `cfg.public-source-maps`: anyone can read your original frontend source code

**Subject:** the config file that turns them on, bare file name with its path if not at the root: `next.config.js`, `vite.config.ts`, `webpack.config.js`, `package.json` (Create React App). One finding per app.
**OWASP:** `A02:2025 Security Misconfiguration`. **fix_risk:** `low` (`may_break`: an error tracker that reads source maps from your public site shows minified stack traces until you upload the maps to it at build time).

**Find it:** Next.js `productionBrowserSourceMaps: true`; Vite `build.sourcemap: true` or `'inline'` (`'hidden'` is fine: the maps are built but not linked from the code); webpack `devtool: 'source-map'` (or any value without `hidden-` or `nosources-`) in the production config; Create React App (`react-scripts build`) without `GENERATE_SOURCEMAP=false` in the build script or a committed `.env.production`, because it publishes maps by default.

**Confirm:** you can point at the setting (or, for Create React App, the `build` script line) and the build output is what the host serves.

**Severity:** `low`. Source maps rebuild your original browser code with comments and file names, which helps an attacker find weak spots; they never contain server code. If you see a real secret in browser code, that is `check-secrets`' finding, not a reason to raise this one.

## Fixes

Read `references/headers.md` before writing any `cfg.missing-headers` `fix_plan` or applying one: it has a ready-to-paste headers block per host (Next.js, Vercel, Netlify `netlify.toml` and `_headers`, Firebase Hosting, Express with helmet, Flask, Django, SvelteKit) and how to roll out CSP in report-only mode before enforcing it. Rules for headers fixes:

- **CSP starts as `Content-Security-Policy-Report-Only`**, always, on every stack. If the app's host and framework give no way to send a header (a static app on an `unknown` host), don't add an enforced `<meta>` CSP: put "Add a Content-Security-Policy in your host's header settings, starting in report-only mode" in `manual_steps` and fix only what you can.
- **Fill `connect-src`, `frame-src`, `script-src` and `form-action` from the code before writing the policy:** search for the Supabase, Firebase and Stripe clients, `fetch(`/`axios` calls to other hosts, `<script src=`, `<iframe`, and forms that post to another site or to a route of yours that redirects to one (Stripe Checkout sessions, OAuth sign-in), and list each host. `fix_plan` names the hosts you added.
- **HSTS without `preload`** (`max-age=63072000; includeSubDomains`), unless the user asks: preloading is hard to undo. Leave HSTS out on Vercel and Netlify.
- **Clickjacking:** `DENY` unless the app is embedded on purpose (see "Embedding on purpose").

Read `references/config-fixes.md` for the other three checks: a CORS allowlist per stack, debug settings driven by the environment, generic error responses with server-side logging, log redaction, and turning off public source maps (or uploading them to an error tracker and deleting them).

Before writing `may_break`, search for what the change touches (frontends on other domains for CORS, outside scripts and iframes for headers, browser code that shows server error text) and name them with `file:line`.

## Not a finding

- **`*` without credentials** on a public, read-only API, an image or font host, or a webhook receiver. **Supabase Edge Functions** with the usual `corsHeaders = { 'Access-Control-Allow-Origin': '*', … }` and no `Access-Control-Allow-Credentials`, where the caller sends the Supabase token in the `Authorization` header: other sites can't read anyone's token, so they can't call it as your user. Whether the function checks that token is `check-auth`'s question. **Supabase's own API** (`*.supabase.co`) sends permissive CORS headers by design and authenticates with the `apikey` and `Authorization` headers: not a finding, and not something your code can change. More generally, CORS with credentials on an API whose callers authenticate only with an `Authorization` header token (no auth cookie).
- **An echoed origin checked against an allowlist** (`allowed.includes(origin)` with full origins such as `https://app.example.com`), and CORS on routes that need no login and return only public data.
- **Missing HSTS on Vercel or Netlify**, which add it themselves. A missing `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy` on its own.
- **A CSP that exists but isn't perfect:** `'unsafe-inline'` in `style-src`, a local development address in `connect-src`, a broad `img-src`. Don't report these, and don't list them under "worth a look" either. (`'unsafe-inline'` or `'unsafe-eval'` in `script-src` may go under "worth a look" as an `unverified` `cfg.missing-headers`; never above that. Exception: a Next.js app without a nonce setup in its middleware needs `'unsafe-inline'` in `script-src` for Next's own inline scripts, so don't list it there.)
- **Development-only settings:** Vite `server.headers` or `server.cors`, `next dev`, `.env.development`, `settings/dev.py` or `local.py` when production uses another settings file, `debug=True` inside tests, notebooks or scripts that never serve requests.
- **Framework defaults that already hide details:** a Next.js route that throws (production returns a plain 500 with no stack), Express's default error handler (it hides the stack when `NODE_ENV=production`, which hosts set), Flask and Django with debug off. "No try/catch" or "no error handler" alone is not a finding.
- **Messages written for end users:** Stripe card errors (`StripeCardError` / `err.type === 'card_error'`) shown to the buyer; Supabase Auth errors returned after sign-in, sign-up, password reset or OTP calls (`return { error: error.message }`); validation errors from zod, yup, joi or valibot; messages your own code wrote ("Email is required"). Database and PostgREST error messages and raw exceptions are not in this list: they stay findings.
- **Logging errors on the server** (`console.error(err)`, `logger.exception(…)`): that's what should happen. Logs of ids, paths, status codes or non-secret fields. Browser `console.log` of the user's own non-secret data.
- **No logging, monitoring or alerting at all:** it can't be proven from code and has nothing specific to fix. Don't report it; at most one line under "worth a look" if the app takes payments or has an admin area.
- **Source maps** that are `hidden`, uploaded to an error tracker and deleted after upload (Sentry's build plugin with `filesToDeleteAfterUpload`; `@sentry/nextjs` hides them by default), or server-only.
- Anything under the excluded paths.

## What's already good

Collect lines like these, only for things you actually checked: "Your pages send a Content-Security-Policy, clickjacking protection and HSTS", "Your host adds HSTS for you", "Your API only accepts cross-site calls from your own domains", "Your API routes return a generic error message and log the details on the server", "Debug mode is controlled by an environment variable and off by default", "Your production build doesn't publish source maps".

## Findings file

`.vibe-secure/findings/config.json`. The whole file, every time (with `"findings": []` when nothing is wrong). `generated_at` comes from `node -e "console.log(new Date().toISOString())"`:

```json
{ "area": "config", "generated_at": "<output of that command>", "mode": "audit", "findings": [ … ] }
```

Ids are `config-1`, `config-2`, … in this run. Example of one finding (illustrative values):

```json
{
  "id": "config-1",
  "check": "cfg.cors-wildcard-credentials",
  "subject": "/api/account",
  "area": "config",
  "owasp": "A02:2025 Security Misconfiguration",
  "severity": "high",
  "title": "Any website your users visit can read their account details from your API",
  "impact": "Your /api/account route copies the caller's Origin into Access-Control-Allow-Origin and allows credentials, and your session cookie is set with SameSite=None, so browsers send it on other sites' requests. If a signed-in user opens any other website, that site's code can call your API with the user's cookies and read the reply: their name, email and billing details.",
  "evidence": [
    { "file": "src/app/api/account/route.ts", "line": 6 },
    { "file": "src/app/api/account/route.ts", "line": 7 }
  ],
  "fix_plan": "Only allow your own frontend's address: check the Origin against a fixed list (https://app.example.com) and send no CORS headers for anything else.",
  "fix_risk": { "level": "high", "may_break": "A frontend served from another domain stops getting answers until its address is added to the list." },
  "manual_steps": [],
  "status": "open"
}
```
