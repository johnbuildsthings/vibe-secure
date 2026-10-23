# RED baseline: auth (no plugin)

Date: 2026-10-23. Prompt: `claude -p "Check this project's authentication and login security: routes or server actions with no login check, code that trusts a user id or role sent by the browser, admin pages protected only in the UI, login forms without rate limiting, and weak session cookies or tokens. Report only."`, run in a temp copy of each fixture (expected files and `history.sh` removed, git initialised with one commit), allowed tools `Read Grep Glob Bash(node:*) Bash(git:*) Bash(ls:*) Bash(cat:*)`, no `--plugin-dir`.

Fixtures: `react-firebase-open`, `nextjs-supabase-leaky`, and `secure-baseline` as the false-positive check.

## What plain Claude got right

- `react-firebase-open`: found that the admin screen is hidden only by a browser-side `role === 'admin'` check while the data it lists and deletes has no server check, and that the `role` the app trusts lives in a document the user can write (rated critical).
- `nextjs-supabase-leaky`: noticed that the checkout route has no session check and that the app has no login flow, so there is no login form to rate-limit and no cookie to harden.
- `secure-baseline`: no false positives. It followed `getUser(req)` into the helper and saw that it verifies the bearer token with Supabase (`auth.getUser(token)`), accepted the webhook's signature check in place of a login, and treated hosted Supabase Auth as already rate-limited.

As in the other areas, the raw model spots the obvious problems. What it lacks is structure, scope discipline, a consistent line between "needs a login" and "public on purpose", and consistent severity.

## Failures the skill must address

| # | Baseline behaviour | Why it matters | Skill rule that addresses it |
|---|---|---|---|
| 1 | No findings file, no stable check ids or subjects; free-form prose only | The orchestrator, merge, fix loop and scorer can't use it | Each check names its `check` id and `subject` (route path, `action:<name>`, field name, admin page path, cookie or storage key); the file is always written (`findings: []` when clean) and validated |
| 2 | Scope creep: in the Supabase app it reported the service-role key in the browser, RLS off, the committed `.env`, the unsigned webhook, the client-set price, `dangerouslySetInnerHTML` XSS, missing headers and `lodash` as numbered findings of an auth run; in the Firebase app it reported the open `firestore.rules` as finding #1 | Duplicates other areas under different check ids, so merge can't dedupe them | "Stay in this area" hands each one to its skill in one line; the rules file is `check-database-rules`'s finding, this skill reports the trust in the field and the UI-only admin screen |
| 3 | Called the unsigned webhook's `client_reference_id` and a browser `.eq('id', id)` query "trusting a user id from the request" | A webhook is authenticated by its signature (`check-payments`), and a browser query is protected by RLS (`check-database-rules`); neither is a client-trusted identity | `auth.client-trusted-identity` is only for a field naming the caller or their privileges, read on the server (or a user-writable privilege field trusted for access); webhooks and browser queries are listed under "Not a finding" with their owners |
| 4 | Split one root cause into several items: "admin page only in the UI", "users can make themselves admin", "the app never checks who is signed in" and "admin status is checked on the wrong thing" were four entries for the same Firestore app | The user sees the same hole four times with different severities | One finding per root cause: the admin screen (subject = its path) and the trusted field (subject = field name); a browser-only sign-in gate is not its own finding |
| 5 | Inconsistent severity: the Firebase "users can make themselves admin" item was critical, the related "never checks who is signed in" item was High/Medium; the checkout route with no login was critical in one fixture while the same pattern was only a side note elsewhere | Users can't compare runs | Fixed severity rules per check: route-no-session high, critical only when the route returns or changes user data; client-trusted-identity and ui-only-admin high; rate limit and session flags medium |
| 6 | Treated "no login check" as a finding for every route, including a guest checkout that touches no user data | Public-on-purpose routes (guest checkout, contact form, login itself, signed webhooks, public content) are not holes; flagging them teaches users to ignore the report | `auth.route-no-session` applies only to routes that read, return or change user or private data, or do privileged work; a "Public on purpose" list says what never needs a login |
| 7 | Accepted any call that looks like a login check; no mention of Supabase `getSession()` on the server, `jwt.decode` without verification, or a middleware that only checks that a cookie exists | These look like checks but trust a token nobody verified | The check lists which calls verify (`getUser()`, `getClaims()`, `verifyIdToken`, `jwtVerify`, `auth()`) and which don't (`getSession()` on the server, `jwt.decode`, cookie-exists middleware); middleware counts for pages only, and for route handlers or server actions only when its matcher covers them and it verifies the session |
| 8 | Fix advice was prose ("use custom claims", "use @supabase/ssr") without what may break | Adding a login check or moving a role to the server locks people out of screens that worked before | Every access fix is `fix_risk: high`, with `may_break` naming the callers found; per-stack fix code in `references/auth-fixes.md` |

## Not observed, but guarded anyway (from the brief)

- Flagging hosted login (Supabase Auth, Firebase Auth, Clerk, Auth0, Auth.js OAuth providers) as "no rate limit": the baseline got this right; the skill says so explicitly, and says that a custom password check (including an Auth.js Credentials provider) does count.
- Flagging the Supabase or Firebase SDK's own token storage in `localStorage`/IndexedDB as a weak session: only tokens your own code stores count.
- Vendor and build output: `node_modules`, `.next`, `dist` and lockfiles are excluded from search (search-scope rule).
