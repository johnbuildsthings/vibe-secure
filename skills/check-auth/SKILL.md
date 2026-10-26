---
name: check-auth
description: Use when auditing an app for login and session holes, such as API routes or server actions with no login check, code that trusts a user id or role sent by the browser, admin screens hidden only in the UI, custom login forms with no rate limit, and session cookies or tokens stored unsafely.
disable-model-invocation: true
---

# Check auth

## What this protects against

Your server is the only place that can know who is really asking. If a route or server action never checks the login, or believes a user id or `role` that the browser sent, anyone can act as any user, or as an admin, by editing one request. Hiding a button in the UI doesn't help, because the request can be sent without the UI. Custom login forms with no rate limit let attackers guess passwords, and session tokens stored where page scripts can read them can be stolen.

OWASP: `A07:2025 Authentication Failures` for `auth.route-no-session`, `auth.no-login-rate-limit` and `auth.weak-session`; `A01:2025 Broken Access Control` for `auth.client-trusted-identity` and `auth.ui-only-admin` (the user is known, but the app lets them do what they shouldn't).

## Applies when

An app in `stack.json` has any server code (API route, server action, server-rendered page, edge or cloud function, Express/Flask/FastAPI/Django handlers), **or** its `db` contains `supabase` or `firebase` (a browser-only app talks to the database directly, so the database rules are its server check). Run it once per such app.

- Checks 1, 4 and 5 (cookies) need server code. Skip them for a browser-only app and say so in one line.
- Checks 2 and 3 run for every app that applies. In a browser-only app, "the server check" means the Supabase policies or Firebase security rules.
- Check 5 (tokens in `localStorage`) runs on browser code in every app.

If no app qualifies, write the findings file with `"findings": []` and say in one line that the app has no server code or login to check. If an app's framework is `unknown`, still run every check on route files you can recognise (Flask `@app.route`, FastAPI `@app.get`, Express `app.get`), and say that framework-specific route detection was skipped.

## How to run

Follow the run contract in `<root>/shared/area-skill-template.md` (Part 2). In short:

- `<root>` = two levels up from this skill's base directory (or `Plugin root:` in a dispatch prompt). Project root = the current directory, or the `Project root:` from a dispatch prompt. In that case, use that path wherever a command below says `.`.
- **Mode:** `audit` unless the request says `verify <check> <subject>`.
- **Time stamps:** `node -e "console.log(new Date().toISOString())"`. Never guess.
- **Alone, audit:** `node <root>/scripts/init-workspace.mjs .`, then `node <root>/scripts/detect-stack.mjs .` if `.vibe-secure/stack.json` is missing → run the checks → write `.vibe-secure/findings/auth.json` (always, `"findings": []` when clean) → `node <root>/scripts/validate-findings.mjs .vibe-secure/findings/auth.json` until it passes → follow `<root>/shared/report-and-fix.md` (if the user asked for a report only, still run `merge-findings`, show the report and save it to `.vibe-secure/report-auth.md`; then stop).
- **`dispatched: audit`:** run the checks, write and validate the file, reply with counts, "already good" lines and skipped checks. No report, no fix loop.
- **`verify <check> <subject>`:** no init or detect-stack (read `stack.json` or `package.json` directly); re-run that one check for that subject, reply `PRESENT` or `GONE` plus evidence, write nothing.
- **Dispatched project root:** substitute it for `.` in every command.
- **Search scope:** never look inside `node_modules`, `.next`, `dist`, `build`, `out`, `.vercel`, `.vibe-secure`, `*.min.js` or lockfiles.
- **Commands:** one plain command per Bash call: no `&&`, `;`, `||`, `$?`, `$(…)`, `{…}` or pipes into other programs, because those need extra approval and may be refused. Use the Read and Grep tools for files. Don't write helper scripts or scratch files, in the project or anywhere else.

**Rotations:** this skill has no rotation findings, so it never reads or writes `.vibe-secure/rotations.json`.

### Stay in this area

Report only the five checks below. One root cause is one finding. If you notice any of these, mention it in one line of your reply, name the skill, and write no finding:

- a route that **has** a login check but returns or changes a record by id without checking that it belongs to the user → `check-database-rules` (`db.idor-route`). A route with **no** login check at all is yours (`auth.route-no-session`);
- the database rule or policy that lets users write their own `role`, `plan` or `is_admin` (open Firestore rules, a Supabase update policy without column protection), or that leaves tables open → `check-database-rules`. Your finding is the app *trusting* that field for access (`auth.client-trusted-identity`), not the rule itself;
- a route that relies on a user-scoped Supabase client while the table's RLS is off or open → `check-database-rules` (see check 1);
- a browser-side query such as `.from('<table>').select('*').eq('id', id)` → `check-database-rules` (its safety depends on RLS, not on a login check);
- a webhook without a signature check, or a price, plan or payment status taken from the client → `check-payments`. A webhook is authenticated by its signature, never by a login;
- an AI endpoint with no login, no rate limit or no usage cap → `check-ai-features` (`ai.no-usage-cap`);
- a leaked or hard-coded key, including a hard-coded JWT or session-signing secret → `check-secrets`;
- CORS, debug mode, security headers → `check-config`; SQL or HTML built from user input → `check-injection`.

## How to tell whether a login is checked

Use this for every check. A **session check** is server code that verifies who the caller is and stops when nobody is signed in (returns 401/403, redirects, or throws). The result must be used: calling `auth()` and ignoring a `null` user is not a check.

**These verify the caller:**

| Stack | Verifying calls |
|---|---|
| Supabase | `supabase.auth.getUser()` (a server client built from the request's cookies, `@supabase/ssr`), `admin.auth.getUser(token)` with the bearer token, `supabase.auth.getClaims()` |
| Auth.js / NextAuth | `auth()` (v5), `getServerSession(...)`, `getToken({ req, secret })` from `next-auth/jwt`, `withAuth` middleware |
| Clerk | `auth()` / `currentUser()` from `@clerk/nextjs/server` with a check of `userId`, `auth.protect()`, `clerkMiddleware` with `auth.protect()` for that route |
| Firebase | Admin SDK `verifyIdToken(token)` / `verifySessionCookie(cookie)`; in callable functions (`onCall`) a check of `request.auth` / `context.auth` |
| Custom JWT | `jwtVerify` (jose), `jwt.verify(token, secret)` (jsonwebtoken) with a fixed algorithm |
| Other | Lucia `validateSession`, iron-session `getIronSession` plus a check of the stored user, Passport `req.isAuthenticated()` or a `req.user` set by verifying auth middleware, Flask-Login `@login_required` / `current_user.is_authenticated`, Django `@login_required` / `LoginRequiredMixin` / `request.user.is_authenticated`, FastAPI `Depends(get_current_user)` that verifies a token |

When a route calls a helper (`getUser(req)`, `requireUser()`), open the helper and check that it ends in one of these calls. A helper you can't follow (an import from a package you can't read) counts as a check, but say so under "worth a look" if it guards personal data.

**These look like checks but don't verify anything:**

- Supabase `supabase.auth.getSession()` on the server: it reads the session from the cookie without checking the token with Supabase, so a forged cookie passes. Using it to decide who the user is → `auth.route-no-session`, `high` (see check 1).
- `jwt.decode(...)`, `jwtDecode(...)`, or `JSON.parse(atob(token.split('.')[1]))`: reads a token without checking its signature. `jwt.verify` with `algorithms: ['none']` is the same.
- Checking only that a cookie or header **exists** (`if (!cookies().get('session')) return 401`) without verifying its value.
- A user id, email or role read from a request header (`x-user-id`), the body, the query string or an unsigned cookie (that is check 2, not a session).
- Anything in browser code: `if (!user) return <Login />`, route guards, `useSession()` in a client component. They decide what the screen shows, not what the server allows.

**Next.js `middleware.ts` (or `middleware.js`, `proxy.ts`):** a middleware whose `matcher` covers a **page** and that verifies the session (one of the verifying calls above, or Clerk/Auth.js middleware that protects it) counts as the session check for that page. It does **not** count for route handlers (`app/**/route.*`, `pages/api/**`) or server actions unless (a) the matcher covers that route's path (server actions run on the path of the page that calls them) **and** (b) the middleware verifies the session, not just checks that a cookie exists. Many matchers exclude `/api` (`'/((?!api|_next/static|_next/image|favicon.ico).*)'`), so read the pattern before relying on it. When in doubt, the route needs its own check.

## Checks

### 1. `auth.route-no-session`: a route or server action has no login check

**Subject:** the route path as users call it, with dynamic parts as `:name` (`/api/notes/:id`). For a server-rendered page, the page path the same way (`/account/billing`). For a server action, `action:<functionName>` (`action:deleteAccount`). For a Supabase Edge Function, `/functions/v1/<name>`. For a Firebase or other cloud function, `fn:<exported name>`.
**OWASP:** `A07:2025 Authentication Failures`. **fix_risk:** `high`.

**Find it:** list every piece of server code that runs on a request:

- Next.js: `app/**/route.(js|ts)`, `pages/api/**`, server actions (a `'use server'` file's exported functions, or functions with `'use server'` inside), and server components (`app/**/page.*`, `app/**/layout.*` without `'use client'`) that load private data;
- SvelteKit `+server.*`, `+page.server.*` (`load` and `actions`); Remix `loader` / `action`; Express, Fastify, Hono and Koa routes and routers; tRPC procedures (`publicProcedure` vs `protectedProcedure`);
- `supabase/functions/**`, Firebase `functions/**` (`onRequest`, `onCall`), `netlify/functions/**`, Vercel `api/**`;
- Flask, FastAPI and Django views.

For each, decide whether it **needs** a login: it reads, returns, changes or deletes data that belongs to users or isn't public (accounts, orders, messages, files, settings, anything filtered by a user), or does something on a user's behalf or with privileges (sends email as the app, changes a plan, admin actions, triggers paid jobs or exports). Then look for a session check (above) on every path through the handler, or a covering middleware (above).

**Confirm:** you can point at the handler line and the data it touches, and there is no verifying session check before it.

**Row level security as the check (not a finding):** when a route, server action or server component reaches data **only** through a user-scoped Supabase client, that is a client built with the anon or publishable key plus the request's cookies (`createServerClient` from `@supabase/ssr`) or the caller's bearer token (`global: { headers: { Authorization } }`), never the `service_role` key, and the tables it touches have RLS policies that check `auth.uid()`, then RLS is the login check. A request with no session gets nothing back and can change nothing. List it under "already good". If one of those tables has RLS off or open policies, say so in one line → `check-database-rules`, and don't report the route here. This doesn't apply when the same handler also uses an admin or `service_role` client, Prisma, Drizzle, or another client that ignores RLS, or does privileged work outside the database (sending email, calling paid APIs).

Also report a route whose only check is `getSession()` on the server, `jwt.decode`, or a cookie-exists test. A Supabase Edge Function counts as unchecked when it never calls `supabase.auth.getUser(token)` (or `getClaims`): the platform's default JWT check accepts the public anon key, so it doesn't tell you who the caller is. A Firebase `onCall` function counts as unchecked when it never reads `request.auth`; an `onRequest` function when it never calls `verifyIdToken`.

**Public on purpose (not a finding):** login, signup, password-reset and OAuth callback routes (the session doesn't exist yet); public content (product lists, published posts, a public profile without email or phone); health checks; contact, waitlist or guest-checkout routes that only use what the visitor sends and return nothing private; webhooks (`check-payments` owns their signature check); cron or internal routes that check a shared secret header (`authorization === \`Bearer ${process.env.CRON_SECRET}\``) before doing anything.

**Severity:** `critical` when the route returns or changes user data (personal fields, other users' records, account or plan changes, deletes) with no check at all, because anyone can call it with no skill. `high` otherwise: privileged actions that don't expose or change user data, and routes whose only check doesn't verify (Supabase `getSession()` on the server, `jwt.decode`, cookie-exists), because forging a session takes some skill. If such a route also trusts a user id from the request, that is part of this one finding: say so in `impact`, don't add a check-2 finding. Put the handler line and the line that touches the data in `evidence`.

### 2. `auth.client-trusted-identity`: the app believes who the browser says the user is

**Subject:** the trusted field name, bare (`userId`, `email`, `role`, `is_admin`, `plan`). One finding per field.
**OWASP:** `A01:2025 Broken Access Control`. **fix_risk:** `high`.

**Find it:** two shapes.

1. **Server code trusts a request field about the caller.** A field that names the acting user or their privileges (`userId`, `user_id`, `uid`, `email`, `role`, `isAdmin`, `is_admin`, `plan`, `tier`, `ownerId` when it means "me") is read from `req.body`, `await req.json()`, `formData`, `searchParams`, `req.query`, a header (`x-user-id`, `x-role`), an unsigned cookie, or a server action's arguments (they come from the browser too), and is then used to decide whose data to read or change, to attribute a write, or to grant access (`if (body.role === 'admin')`). This applies even when the route also has a session: using `body.userId` instead of `session.user.id` is the hole. A field that names a **record** (`orderId`, `id`) is not this check; that's `db.idor-route` (`check-database-rules`).
2. **A user-writable field is trusted for access** (Supabase or Firebase, often with no server at all). The app reads a privilege field (`role`, `isAdmin`, `is_admin`, `admin`, `plan`, `tier`, `credits`, `subscription_status`) from the user's own document or row, or from `localStorage`, and uses it to show admin screens, unlock paid features, or as a condition in rules or policies; **and** the user can write that field. Some places are **always** user-writable, so trusting a role, plan or admin flag from them is a finding without showing a write path: Supabase `user_metadata` (`user.user_metadata.role`, `raw_user_meta_data` in SQL, `auth.jwt() -> 'user_metadata'` in policies), which any signed-in user can set with `supabase.auth.updateUser({ data: { role: 'admin' } })`, and Clerk `unsafeMetadata`. This covers app code and RLS policies alike (a policy that reads it belongs to you; mention the table to `check-database-rules` in one line). Supabase `app_metadata` and Clerk `publicMetadata` / `privateMetadata` can only be set from the server, so they are safe. Otherwise, the user can write the field when the client writes it (`setDoc`/`updateDoc`/`.update()`/`.upsert()` with that field, or with a whole form object that includes it), or the Firestore rules or Supabase policies let users update their own document or row without blocking that field (open rules, `allow write: if request.auth.uid == uid` with no field check, an update policy with no column grant or trigger). Point at the read that grants access **and** the write path or rule line.

**Confirm:** the field really comes from the request or a user-writable place, and something real depends on it: data, actions or paid features that are enforced **only** through that field (a server or rules check that reads it, or browser-side gating of data whose rules don't check anything stronger). Not a finding when the server takes the identity from a verified session (`session.user.id`, `user.id` from `getUser()`), when the role comes from a source users can't write (Firebase custom claims via `getIdTokenResult()` / `request.auth.token.admin`, Supabase `app_metadata`, Clerk `publicMetadata` / `privateMetadata`, a server-only table, a column protected by grants or a trigger), when the field is only displayed, or when the browser uses it only to show or hide a link or screen while the server or rules check admin rights or the plan from a trusted source. A user who flips it then sees an empty screen and nothing more.

**Severity:** `high`.

### 3. `auth.ui-only-admin`: the admin screen is hidden, but not protected

**Subject:** the admin page's path as users open it (`/dashboard/admin`, `/internal`). If the screen has no path of its own (shown by a state switch), the path or condition that shows it; as a last resort, the component name.
**OWASP:** `A01:2025 Broken Access Control`. **fix_risk:** `high`.

**Find it:** admin or staff screens: pages or routes under `admin`, `internal`, `staff`, `backoffice`, `moderation`; components named `Admin…`; browser code that shows a screen or link only when `role === 'admin'`, `isAdmin`, `user.email === '…'`, or redirects non-admins away in the browser (`router.push`, `<Navigate>`, `if (!isAdmin) return null`). Then list every piece of data and every action that screen uses: API routes it calls, server actions, and direct database calls from the browser (`getDocs(collection(db, '<c>'))`, `deleteDoc`, `.from('<table>').select()/.delete()`).

**Confirm:** at least one of those data reads or actions has no server-side admin check: the API route or server action doesn't check the session **and** an admin role from a trusted source; or, for direct database calls, the Firestore rules or Supabase policies don't limit them to admins (open rules, any signed-in user, or a role field users can write). Not a finding when every read and action is checked on the server (a server component or route that verifies the session and the role, middleware that verifies the role for the page and its API, rules like `request.auth.token.admin == true`, policies that check an admin table users can't write). Hiding links in the UI is then just good design.

**Severity:** `high`. One finding per admin screen. Put the browser-side check and each unprotected read or action in `evidence`, and don't also report those routes under check 1: the unprotected admin area is one root cause. When an admin route or action that the screen uses has **no session check at all**, the finding takes the worse of this check's severity and check 1's rule (`critical` when that route returns or changes user data). Say in `impact` that the route doesn't even need a login.

### 4. `auth.no-login-rate-limit`: your own login form lets attackers guess passwords

**Subject:** the login or code-check route path (`/api/login`, `/api/verify-code`); for a server action, `action:<functionName>`; for an Auth.js Credentials provider, `/api/auth/callback/credentials`.
**OWASP:** `A07:2025 Authentication Failures`. **fix_risk:** `low`; `may_break`: people who mistype their password too often have to wait, and a stranger who spams someone's email with wrong passwords can lock that person out while they keep at it.

**Find it:** code that checks a password or one-time code itself: `bcrypt.compare`, `bcrypt.compareSync`, `argon2.verify`, `scrypt`/`pbkdf2` comparisons, `check_password_hash`, a comparison against a stored password or code, an Auth.js / NextAuth `CredentialsProvider` / `Credentials({ authorize })`, routes that verify OTP, magic-link, 2FA or password-reset codes your app generated.

**Confirm:** nothing limits attempts for that route: no rate limiter (`@upstash/ratelimit`, `express-rate-limit`, `rate-limiter-flexible`, `slowapi`, Flask-Limiter, `django-ratelimit`, `django-axes`), no failed-attempt counter or lockout, and no middleware or host config in the repo that limits that path. An in-memory counter counts as a limit (mention under "worth a look" that it resets on restart and isn't shared between servers).

**Severity:** `medium`.

### 5. `auth.weak-session`: your session cookie or token can be stolen or misused

**Subject:** the cookie name (`session`, `auth_token`) or the storage key (`accessToken`, `jwt`).
**OWASP:** `A07:2025 Authentication Failures`. **fix_risk:** `low` for cookie flags, unless browser code reads that cookie. Search for `document.cookie` and cookie libraries (`js-cookie`'s `Cookies.get`, `universal-cookie`, `react-cookie`). If any of them read it, use `high`, because `httpOnly` hides the cookie from those reads, and name each one with `file:line` in `may_break`. `high` for moving a token out of `localStorage`, because it changes how the browser and server exchange the login.

**Find it:**

- **Cookies your code sets** that hold a session id, token or user id: `cookies().set(name, value, opts)`, `response.cookies.set`, `res.cookie(...)`, `serialize(...)` from `cookie`, a raw `Set-Cookie` header, express-session / cookie-session options, Flask `SESSION_COOKIE_*` settings or `response.set_cookie(...)`, Django `SESSION_COOKIE_SECURE` / `SESSION_COOKIE_HTTPONLY`. Report when `httpOnly` is missing or false, `secure` is missing or false (a `secure: process.env.NODE_ENV === 'production'` is fine), or `sameSite` is missing or `'none'` without a reason. List every missing flag in one finding per cookie.
- **Tokens your own code stores in the browser:** `localStorage.setItem` / `sessionStorage.setItem` with a token, JWT, session id or refresh token (`token`, `accessToken`, `jwt`, `authToken`, `refreshToken`).

**Confirm:** you can point at the line that sets the cookie or stores the token, and it holds login state.

**Severity:** `medium`.

## Fixes

Read `references/auth-fixes.md` before writing any `fix_plan` or applying a fix. It has, per stack: a verified session check for route handlers, server actions, server components, Edge and cloud functions; a middleware that protects pages and API routes together; taking the user id from the session instead of the request; moving roles to a place users can't write (Firebase custom claims, Supabase `app_metadata` or a protected column) and checking them on the server or in rules; a rate limiter for login and code routes; and safe cookie options.

**Every fix for checks 1–3 is `fix_risk.level: "high"`**, because it changes who can call what. Before writing `may_break`, search the code for callers and name them with `file:line`:

- browser code that calls the route or server action without sending credentials (a `fetch` without the cookie or `Authorization` header, a mobile or script client);
- screens that worked for signed-out visitors and will now get 401;
- admin users whose role lives in the old user-writable field, who need to be given the role in the new place (say how in `manual_steps`).

If nothing calls the route without credentials, say so: "Every caller already sends the login, so nothing visible should change."

## Not a finding

- Hosted login: Supabase Auth, Firebase Auth, Clerk, Auth0, and Auth.js / NextAuth OAuth or email providers. Their own sign-in endpoints are rate-limited by the provider, and their SDKs store the session safely; never report `auth.no-login-rate-limit` or `auth.weak-session` for them. (An Auth.js **Credentials** provider runs your own password check, so check 4 applies to it.)
- The Supabase or Firebase SDK keeping its session in `localStorage` or IndexedDB by default: that's the SDK's design, not your code storing a token.
- The routes listed under "Public on purpose" in check 1, and webhooks of any kind.
- A browser-side login gate (`if (!user) return <SignIn />`) on its own, with the data protected by the server or by rules. It's how apps show the right screen.
- Ids taken from a verified session or from a verified webhook event.
- Routes and server components that reach data only through a user-scoped Supabase client (anon or publishable key plus the request's cookies or token) on tables whose RLS checks `auth.uid()` (see check 1).
- Roles from Firebase custom claims, Supabase `app_metadata`, Clerk `publicMetadata` / `privateMetadata`, or a column users can't update.
- A role or plan the browser uses only to show or hide links, when the server or rules enforce it from a trusted source.
- Test files, fixtures and seed scripts, and anything under the excluded paths.

## What's already good

Collect lines like these, only for things you actually checked: "Every API route checks the login with `getUser()` before touching data", "Your dashboard reads data with the signed-in user's Supabase client, so row level security only returns that user's rows", "Your middleware verifies the session for `/dashboard` pages and `/api` routes", "Your checkout takes the user from the verified session, not from the request", "Admin access comes from a custom claim users can't change", "Your webhook relies on its signature instead of a login, which is correct", "Sign-in is handled by Supabase Auth, which rate-limits login attempts", "Your session cookie is `httpOnly`, `secure` and `sameSite=lax`".

## Findings file

`.vibe-secure/findings/auth.json`. The whole file, every time (with `"findings": []` when nothing is wrong). `generated_at` comes from `node -e "console.log(new Date().toISOString())"`:

```json
{ "area": "auth", "generated_at": "<output of that command>", "mode": "audit", "findings": [ … ] }
```

Ids are `auth-1`, `auth-2`, … in this run. Example of one finding (illustrative values):

```json
{
  "id": "auth-1",
  "check": "auth.route-no-session",
  "subject": "/api/notes/:id",
  "area": "auth",
  "owasp": "A07:2025 Authentication Failures",
  "severity": "critical",
  "title": "Anyone can read or delete any user's notes without logging in",
  "impact": "The notes route never checks who is calling. A stranger can send a request with any note id and get the note back, or delete it, without an account.",
  "evidence": [
    { "file": "app/api/notes/[id]/route.ts", "line": 4 },
    { "file": "app/api/notes/[id]/route.ts", "line": 7 }
  ],
  "fix_plan": "Check the login at the top of the route with supabase.auth.getUser() and return 401 when nobody is signed in, then load the note only if it belongs to that user.",
  "fix_risk": { "level": "high", "may_break": "src/components/NoteList.tsx:18 calls this route from the browser; it already sends the login cookie, so it keeps working. Anything calling it without a login gets 401." },
  "manual_steps": [],
  "status": "open"
}
```
