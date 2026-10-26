---
name: check-database-rules
description: Use when auditing an app for database access holes, such as Supabase tables with row level security off, policies that let anyone read or change every row, open Firebase security rules, and API routes that return any record by id without checking who owns it.
disable-model-invocation: true
---

# Check database rules

## What this protects against

Apps built on Supabase or Firebase talk to the database straight from the browser, with a key that is public by design. The only thing that stops a stranger from reading or changing everyone's data is the database's own rules: row level security (RLS) policies in Supabase, security rules in Firebase. When those rules are missing or say "allow everyone", anyone can download or rewrite your users' data with a few lines of code. Your own API routes have the same problem when they return a record by its id without checking that it belongs to the person asking.

OWASP: `A01:2025 Broken Access Control` for every check in this skill.

## Applies when

An app in `stack.json` has `db` containing `supabase`, `firebase`, `prisma`, `drizzle` or `mongodb`, **or** has any server API route (see check 4). Run it once per such app.

- Checks 1 and 2 (and check 5 for Supabase) run only for apps using `supabase`.
- Check 3 (and check 5 for Firebase) runs only for apps using `firebase`.
- Check 4 runs for every app with server routes, whatever the database.

If no app qualifies, write the findings file with `"findings": []` and say in one line that the app has no database or API routes to check. If an app's framework is `unknown`, still run checks 1–3 and 5 on its SQL and rules files, run check 4 on any route files you can recognise, and say that framework-specific route detection was skipped.

## How to run

Follow the run contract in `<root>/shared/area-skill-template.md` (Part 2). In short:

- `<root>` = two levels up from this skill's base directory (or `Plugin root:` in a dispatch prompt). Project root = the current directory, or the `Project root:` from a dispatch prompt. In that case, use that path wherever a command below says `.`.
- **Mode:** `audit` unless the request says `verify <check> <subject>`.
- **Time stamps:** `node -e "console.log(new Date().toISOString())"`. Never guess.
- **Alone, audit:** `node <root>/scripts/init-workspace.mjs .`, then `node <root>/scripts/detect-stack.mjs .` if `.vibe-secure/stack.json` is missing → run the checks → write `.vibe-secure/findings/database-rules.json` (always, `"findings": []` when clean) → `node <root>/scripts/validate-findings.mjs .vibe-secure/findings/database-rules.json` until it passes → follow `<root>/shared/report-and-fix.md` (if the user asked for a report only, still run `merge-findings`, show the report and save it to `.vibe-secure/report-database-rules.md`; then stop).
- **`dispatched: audit`:** run the checks, write and validate the file, reply with counts, "already good" lines and skipped checks. No report, no fix loop.
- **`verify <check> <subject>`:** no init or detect-stack (read `stack.json` or `package.json` directly); re-run that one check for that subject, reply `PRESENT` or `GONE` plus evidence, write nothing.
- **Dispatched project root:** substitute it for `.` in every command.
- **Search scope:** never look inside `node_modules`, `.next`, `dist`, `build`, `out`, `.vercel`, `.vibe-secure`, `*.min.js` or lockfiles.
- **Commands:** one plain command per Bash call: no `&&`, `;`, `||`, `$?`, `$(…)`, `{…}` or pipes into other programs, because those need extra approval and may be refused. Use the Read and Grep tools for files. Don't write helper scripts or scratch files, in the project or anywhere else.

**Rotations:** this skill has no rotation findings, so it never reads or writes `.vibe-secure/rotations.json`.

### Stay in this area

Report only the five checks below. One root cause is one finding. If you notice any of these, mention it in one line of your reply, name the skill, and write no finding:

- a server key (such as Supabase `service_role`) in browser code, or any leaked key → `check-secrets`. Report the RLS problem anyway: which key the browser uses doesn't change whether the table is protected;
- a route or server action with **no login check at all**, an admin screen hidden only in the UI, or code that trusts a user id or `role` sent by the browser → `check-auth`;
- prices, plans or payment status set by the client, or an unsigned webhook → `check-payments`;
- SQL built from strings, or HTML rendered from user data → `check-injection`.

A browser-side query such as `.from('orders').select('*').eq('id', id)` is **not** its own finding. Whether it leaks depends on the table's RLS, so it is evidence for check 1 or 2 and a `may_break` item for their fixes.

## Checks

### 1. `db.rls-disabled`: a Supabase table has no row level security

**Subject:** the table name, without schema (`orders`). For a view, the view name. For a function (step 6), `rpc:<function name>` (`rpc:get_invoice`), so it never collides with a table of the same name.
**OWASP:** `A01:2025 Broken Access Control`. **fix_risk:** `high`.

**Find it:**

1. Read every `.sql` file in the app: `supabase/migrations/*.sql` in filename order, plus `supabase/schema.sql`, `supabase/seed.sql` and any other `.sql` file (Glob `**/*.sql`, minus the excluded paths).
2. List every `create table` in a schema the API exposes: `public` (no schema prefix means `public`), plus any schema listed under `schemas` in `supabase/config.toml` (`[api]` section).
3. For each table, find its **final** RLS state across all files in order: `alter table … enable row level security` turns it on; `alter table … disable row level security` turns it off again. A table with no `enable` line is off.
4. Find where the app queries it (for evidence and `may_break`, not for severity): `.from('<table>')` in browser code. Browser code is: Next.js files starting with `'use client'` and every file they import (a shared `lib/` client imported by a client component counts), `pages/**` components (not `pages/api/**`); everything under `src/` in Vite and other single-page apps; SvelteKit and Remix files that aren't server-only (`*.server.*`, `+server.*`, `src/lib/server/**`); mobile app code.
5. Views: a `create view` in `public` that selects from another table bypasses that table's RLS unless it is created `with (security_invoker = true)` (or `security_invoker = on`). Report such a view under this check, with the view name as subject, when it selects user data.
6. Functions: a `security definer` function in an exposed schema runs with its owner's rights and ignores RLS. Postgres grants `execute` to `PUBLIC` by default, and `anon` and `authenticated` inherit it, so anyone with the public key can call it through `/rest/v1/rpc/<name>` unless `execute` is revoked from `public`, `anon` **and** `authenticated`. Only API-callable functions count: a function that `returns trigger` (such as the usual new-user trigger on `auth.users`) or that is only used inside policies or other functions can't be called through `/rpc`, so it is never a finding. When an API-callable `security definer` function reads or changes personal data without checking `auth.uid()` against the rows it touches, report it under this check with subject `rpc:<function name>`. **Severity:** `critical` when `anon` can call it (no revoke from `public` and `anon`), `high` when only signed-in users can (`execute` revoked from `public` and `anon`, granted to `authenticated`).

**Confirm:** the table's final state is off (point at the `disable` line if there is one, else the `create table` line), and the table is in an exposed schema. Not a finding when `revoke all on <table> from anon, authenticated` (or a revoke of every privilege from both roles) leaves no access through the public API, or when the table is in a schema the API doesn't expose (anything other than `public`, unless `supabase/config.toml` lists it under `schemas`).

**Severity:** always `critical` for a table (or view) in a schema the API exposes, whether or not the app's own code queries it. The public (anon) key ships in every Supabase frontend, and anyone holding it can query every exposed table directly through Supabase's API, without going through your app. When browser code also queries the table, add that `file:line` to evidence. When nothing in the app queries it, say in `impact` in plain words: "Your public key can read and change this table even if your app never does." Never lower the severity because the app doesn't use the table.

### 2. `db.permissive-policy`: a Supabase policy lets anyone through

**Subject:** the name of the table the policy is on (`orders`), not the policy name.
**OWASP:** `A01:2025 Broken Access Control`. **fix_risk:** `high`.

**Find it:** in the same `.sql` files, read every `create policy` (and `alter policy`), noting its table, command (`for select | insert | update | delete | all`, default `all`) and roles (`to anon`, `to authenticated`, `to public`, default everyone). A later `drop policy` removes it. Report a table when one of these holds:

1. **Open to everyone:** `using (true)` or `with check (true)` (or an expression that is always true, such as `1 = 1`, or `auth.role() = 'authenticated'` / `auth.uid() is not null` alone) on a table that holds personal data. "Personal data" means private or personal fields: `email`, `phone`, `address`, private messages, payment amounts, drafts, private notes, or other content only its owner should see. An owner or author column (`user_id`, `author_id`, `created_by`) on content meant to be public (posts, comments, products, public profiles without email, phone or address) does **not** make it personal data: public read on such a table is not a finding, and a stray owner column it exposes is at most `medium`. Signed-in-only conditions count as open: anyone can sign up.
   **Insert-only exception:** a policy that only allows `insert` with `with check (true)` (a waitlist, contact form or feedback table), with no open select, update or delete on that table, is not a finding: list it under "already good" and note that it can attract spam. It is still a finding (`critical`) when the table has an owner column, because users could then create rows under someone else's id.
2. **Supabase Storage:** a bucket created with `public = true`, or a `storage.objects` policy that checks only `bucket_id = '<bucket>'` without tying the file to its owner (`owner = auth.uid()`, or `auth.uid()::text = (storage.foldername(name))[1]`). Subject: `storage:<bucket>` (`storage:uploads`). Apply case 1's personal-data test to the files:
   - images meant to be seen (avatars, product photos) in a public bucket, or with bucket-only **read**: not a finding; list it under "already good";
   - bucket-only **update** or **delete** (any bucket): `critical`, because anyone can replace or delete other users' files;
   - bucket-only **insert**: `medium`, because strangers can upload files (abuse and storage costs, not theft);
   - a public bucket, or bucket-only **read**, holding private files (documents, invoices, ID scans): the read rules below (`critical` for anon, `high` for signed-in only).
3. **Users can promote themselves:** an `update` (or `all`) policy lets users update their own row, and that row has a privilege column (`role`, `is_admin`, `admin`, `plan`, `tier`, `credits`, `subscription_status`, `verified`), with nothing stopping them from changing it. Something stops them when: column grants limit what users may update (`revoke update on <t> from authenticated` followed by `grant update (<safe columns>) on <t> to authenticated`), a trigger rejects or resets changes to those columns, or the policy's `with check` pins the column to its current value. If any of these is in place, it is not a finding; list it under "already good".

**Confirm:** you can point at the `create policy` line, and for cases 1 and 2 at the column(s) or bucket that make it personal data, for case 3 at the privilege column and the policy.

**Severity:** (Storage in case 2 and functions in check 1 follow their own rules above.) `critical` when the open policy allows a write (`insert`, `update`, `delete` or `all`, apart from the insert-only exception), and for case 3 (a user can give themselves admin rights or a paid plan). For an open **read** of personal data: `critical` when it applies to visitors who aren't signed in (`to anon`, `to public`, or no `to` clause); in `impact`, say "Anyone with your public key can download this, without even signing up." `high` when it is limited to signed-in users (`to authenticated`, or `auth.uid() is not null`); in `impact`, say "Anyone who creates an account can read everyone's …". One finding per table: if a table has several bad policies, use the worst severity and list every policy line in `evidence`.

### 3. `db.firestore-open-rules`: Firebase security rules let anyone in

**Subject:** the rules file name: `firestore.rules`, `storage.rules`, or `database.rules.json` (Realtime Database). If the file is not at the app root, its path from the project root (`apps/web/firestore.rules`).
**OWASP:** `A01:2025 Broken Access Control`. **fix_risk:** `high`.

**Find it:** read `firebase.json` for the rules file paths (`"firestore": { "rules": … }`, `"storage": { "rules": … }`, `"database": { "rules": … }`), and Glob for `**/firestore.rules`, `**/storage.rules`, `**/*.rules` and `**/database.rules.json`. Check Firestore and Storage rules with the same logic. In each file, look at every `allow` line and the `match` path it sits under:

- **Open:** `allow read, write: if true;`, `allow read: if true;` or `allow write: if true;`, or an `allow` with no condition at all (`allow read;` grants access). In Realtime Database rules: `".read": true` or `".write": true`.
- **Test mode:** a condition like `request.time < timestamp.date(2025, 6, 1)` that lets everyone in until a date. Get today's date from the time-stamp command.
- **Any signed-in user:** `if request.auth != null` (or `request.auth.uid != null`) with no comparison to the document's owner (`request.auth.uid == userId`, `resource.data.ownerId == request.auth.uid`), on `match /{document=**}` or on a collection or path that holds user data. In Realtime Database: `"auth != null"`.

**Confirm:** the `allow` line and its `match` line, both with line numbers, in `evidence`. Read-only `if true` on a collection of clearly public content (products, published posts) is not a finding; writes open to everyone always are.

**Severity:** `critical` for **open** rules (read or write), and for **test mode** whose date is still in the future. `high` for **any signed-in user** (anyone can sign up, then read or change everyone's data). Test mode whose date has passed → `medium`: nobody can get in today, but the app is broken and the usual quick fix (moving the date) reopens everything; say so in `impact`. One finding per rules file, with the worst severity and every offending line in `evidence`.

The rules alone decide this check. Whether the app *also* trusts a user-writable `role` field or hides an admin screen only in the UI belongs to `check-auth` (mention it in one line). Your fix must still stop users from writing privilege fields (see `references/firestore-rules.md`).

### 4. `db.idor-route`: an API route returns any record by its id

"IDOR" (insecure direct object reference) means: change the id in the request and you get someone else's data.

**Subject:** the route path as users call it, with dynamic parts written as `:name` (`/api/invoices/:id`). For a server component, the page path the same way (`/invoices/:id`). For a server action or tRPC procedure, its name.
**OWASP:** `A01:2025 Broken Access Control`. **fix_risk:** `high`.

**Find it:** server route handlers: Next.js `app/**/route.(js|ts)`, `pages/api/**`, server actions (`'use server'`), and App Router server components (`app/**/page.*` and `app/**/layout.*` without `'use client'`) that read `params`/`searchParams` and load a record; tRPC procedures that take an `id` in their input; Express/Fastify/Hono `app.get('/…/:id', …)` and routers; SvelteKit `+server.*` and `+page.server.*`; Remix `loader`/`action`; `supabase/functions/**`, Firebase `functions/**`, `netlify/functions/**`, Vercel `api/**`; Flask/FastAPI/Django views. In each, look for an id taken from the request (`params.id`, `searchParams.get('id')`, `req.query`, `req.params`, the request body) that is used to load, change or delete a record: Prisma `findUnique`/`findFirst`/`update`/`delete` with `where: { id }`, Drizzle `eq(table.id, id)`, Supabase `.eq('id', id)`, Mongo `findById` / `findOne({ _id })`, Firestore `doc(…, id)`, raw SQL `where id = $1`.

**Confirm:** all of these hold:

- the route has a login check (it gets the session user: `auth()`, `getServerSession`, `supabase.auth.getUser()`, `verifyIdToken`, `req.user`). A route with no login check at all belongs to `check-auth`; mention it there and don't report it here;
- the record is user data, not public content (products, published posts);
- nothing ties the record to that user: the query doesn't also filter by the session user (`where: { id, userId: user.id }`, `.eq('user_id', user.id)`), there's no comparison after loading (`if (record.userId !== user.id) return 403`), no role check that limits it to admins, and the query doesn't run through a user-scoped Supabase client (anon key plus the user's token) on a table whose RLS policies check the owner. A service-role/admin client, Prisma, Drizzle and Mongo ignore RLS, so they always need the explicit check;
- the id really comes from the request. An id from the session, or from a webhook event whose signature is verified, is not request input.

**Severity:** `high` (an attacker needs an account and must change an id). Put the line that reads the id and the line that loads the record in `evidence`.

### 5. `db.write-unverified`: the rules aren't in your code, so they couldn't be checked

**Subject:** the platform: `supabase` or `firebase`.
**OWASP:** `A01:2025 Broken Access Control`. **Severity:** `unverified`. **fix_risk:** `low` (nothing in the code changes; `may_break`: "Nothing, this is a check in your dashboard."). **Status:** `open`.

**Raise it when:**

- **Supabase:** browser code queries tables (`.from('<table>')`) that no `.sql` file in the repo creates, or there are no `.sql` files at all. Name the tables in `impact`.
- **Firebase:** the app uses Firestore, Storage or the Realtime Database (`getFirestore`, `getStorage`, `getDatabase`, `firebase-admin`, or `firebase.json` naming that service) and the matching rules file isn't in the repo.

Don't raise it for a platform whose config sits in the code but is never used (no SDK calls, no dependency), and don't raise it when the rules are in the repo.

**Evidence:** may be empty; when you have it, add the `file:line` of one query that depends on the missing rules. **`manual_steps`:** the dashboard checklist for that platform from `references/rls-cookbook.md` ("Dashboard checklist") or `references/firestore-rules.md` ("Console checklist"), copied as numbered click-by-click steps.

## Fixes

Read the matching reference before writing any `fix_plan` or applying a fix:

- Supabase (checks 1 and 2): `references/rls-cookbook.md`. Owner-only select/insert/update/delete via `auth.uid() = user_id`; public read with owner-only write; and a column-protecting update (column grants or a trigger) for privilege columns.
- Firebase (check 3): `references/firestore-rules.md`. Owner-only rules per collection, a default-deny catch-all, blocking writes to privilege fields, and Storage rules.
- API routes (check 4): add the owner to the query (`where: { id, userId: user.id }`, `.eq('user_id', user.id)`) and return 404 when nothing matches, so the route doesn't confirm that someone else's record exists. Admin routes check the role on the server first.

**Every fix in checks 1–4 is `fix_risk.level: "high"`**, because it changes who can see what. Before writing `may_break`, search the code for queries the new rule will block, and name them with `file:line`:

- browser queries on that table or collection with no filter by the current user (`.from('<t>').select('*')`, `getDocs(collection(db, '<c>'))`), such as admin lists, leaderboards, search, or pages that show other people's profiles;
- inserts that don't set the owner column (`user_id`) to the current user, which the new `with check` will reject;
- server code that relies on the browser-style client but should use the admin client.

If nothing reads other users' rows, say so: "No query in the app reads other users' rows, so nothing visible should change." Never write a policy or rule that only works because the client filters correctly: the rule itself must limit access.

Apply SQL fixes as a **new** migration file (`supabase/migrations/<timestamp>_<name>.sql`, timestamp from the time-stamp command as `YYYYMMDDHHMMSS`), never by editing an old migration that may already have run. Tell the user that the new migration only takes effect once they run it (`supabase db push`, or paste it into the dashboard's SQL editor). For Firebase, edit the rules file, and tell the user to deploy it (`firebase deploy --only firestore:rules,storage`) or paste it into the console.

## Not a finding

- `using (true)` for `select` (or `allow read: if true`) on an intentionally public table or collection, such as products, published posts or a price list, when its columns hold no personal data (an owner or author column on public content doesn't count; see check 2). List it under "what's already good" with the reason ("Anyone can read `products`, which is meant to be public and holds no personal data"), so the user doesn't "fix" it.
- An insert-only `with check (true)` policy on a table with no owner column and no open select, update or delete (waitlist, contact form, feedback). List it under "already good", noting it can attract spam.
- RLS enabled with no policies: nobody can get in through the public API, which is safe (it may break the app, but that isn't a security hole).
- Privilege columns protected by column grants, a trigger, or a `with check` that pins them.
- Supabase anon / publishable keys and Firebase web config in the browser: they are public by design. The rules are what matter.
- Server code using the service-role or admin client after its own login and owner checks.
- Ids from the session or from a verified webhook event.
- Anything under the excluded paths, and SQL or rules files under test folders (`test/`, `tests/`, `__tests__/`, `fixtures/`) that the app doesn't deploy.

## What's already good

Collect lines like these, only for things you actually checked: "Row level security is on for every table in your migrations", "Users can only read and change their own rows in `orders`", "Users can't change their own `plan`: only `display_name` and `avatar_url` can be updated", "Your Firestore rules only let people read their own documents", "Your API routes check that the record belongs to the signed-in user", plus each intentionally public table with the reason it's fine.

## Findings file

`.vibe-secure/findings/database-rules.json`. The whole file, every time (with `"findings": []` when nothing is wrong). `generated_at` comes from `node -e "console.log(new Date().toISOString())"`:

```json
{ "area": "database-rules", "generated_at": "<output of that command>", "mode": "audit", "findings": [ … ] }
```

Ids are `database-rules-1`, `database-rules-2`, … in this run. Example of one finding (illustrative values):

```json
{
  "id": "database-rules-1",
  "check": "db.permissive-policy",
  "subject": "invoices",
  "area": "database-rules",
  "owasp": "A01:2025 Broken Access Control",
  "severity": "critical",
  "title": "Anyone can change or delete any customer's invoices",
  "impact": "The policy \"allow all\" on invoices uses using (true) for every action, so a stranger with your public key can read, edit or delete every customer's invoices, including amounts and email addresses.",
  "evidence": [
    { "file": "supabase/migrations/20250301120000_invoices.sql", "line": 14 },
    { "file": "src/pages/Billing.tsx", "line": 22 }
  ],
  "fix_plan": "Replace the open policy with owner-only policies: each signed-in customer can read, create, change and delete only invoices where customer_id = auth.uid(). Added as a new migration.",
  "fix_risk": { "level": "high", "may_break": "src/pages/AdminInvoices.tsx:9 lists every customer's invoices from the browser and will show only your own until it moves to a server route that checks for admins." },
  "manual_steps": ["Run the new migration: supabase db push (or paste it into Supabase → SQL Editor and click Run)."],
  "status": "open"
}
```
