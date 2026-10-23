# RED baseline: database-rules (no plugin)

Date: 2026-10-22. Prompt: `claude -p "Check this project's database access rules (Supabase row level security, Firebase security rules, and API routes that return records by id) for problems that let users read or change data they shouldn't. Report only."`, run in a temp copy of each fixture (expected files and `history.sh` removed, git initialised with one commit), allowed tools `Read Grep Glob Bash(node:*) Bash(git:*) Bash(ls:*) Bash(cat:*)`, no `--plugin-dir`.

Fixtures: `nextjs-supabase-leaky`, `react-firebase-open`, and `secure-baseline` as the false-positive check.

## What plain Claude got right

- `nextjs-supabase-leaky`: found `alter table … disable row level security` on the profiles table and explained that anyone can read and change every row, including the `plan` column.
- `react-firebase-open`: found the catch-all `match /{document=**} { allow read, write: if true; }` rule and rated it critical.
- `secure-baseline`: no false positives. It recognised the owner-only select/update policies and the column-level `revoke update … grant update (name, bio)` that protects `plan`, and that the webhook's admin write is safe because it verifies the signature first.

As with secrets, the raw model spots the obvious hole. What it lacks is structure, scope discipline and consistent severity.

## Failures the skill must address

| # | Baseline behaviour | Why it matters | Skill rule that addresses it |
|---|---|---|---|
| 1 | No findings file, no stable check ids or subjects; free-form prose only | The orchestrator, merge, fix loop and scorer can't use it | Each check names its `check` id and `subject` (table, rules file, route path, platform); the file is always written (`findings: []` when clean) and validated |
| 2 | Scope creep: in the Supabase app it reported the service-role key in the browser, the unsigned Stripe webhook, client-set checkout prices, `dangerouslySetInnerHTML` XSS and the committed `.env` as numbered findings of a database-rules run | Duplicates other areas under different check ids, so merge can't dedupe them | "Stay in this area": one line naming `check-secrets`, `check-payments`, `check-injection` etc., no finding |
| 3 | In the Firebase app it reported "any user can make themselves an admin" (client writes `role`) and "admin area only protected in the browser" as database findings | Those are `check-auth` checks (`auth.client-trusted-identity`, `auth.ui-only-admin`); reporting them here doubles them | Explicit hand-off list: client-trusted identity and UI-only admin go to `check-auth`; this skill reports only the rules file, and mentions role protection inside its fix |
| 4 | Labelled a browser-side `.eq('id', id)` Supabase query "fetched by id with no ownership check" (High), a separate finding from the RLS one | A browser query against a table is protected (or not) by RLS, not by the query; splitting one root cause into two findings confuses the user | `db.idor-route` is only for server API routes; client queries are evidence for `db.rls-disabled` / `db.permissive-policy`, and for `may_break` |
| 5 | Inconsistent severity: the open Firestore rule was critical, but "users can write to other users' profiles" (the same open rule) was Medium; in the Supabase app the per-id read was High | Users can't compare runs | Fixed severity rules per check, and one finding per root cause (per rules file / table) |
| 6 | No check of `storage.rules` or of "test mode" expiring rules (`request.time < timestamp.date(…)`); `if request.auth != null` was only mentioned as a fix idea | These are the most common vibe-coded Firebase holes | `db.firestore-open-rules` covers `if true`, expiring test-mode rules, and signed-in-only rules on user data, for both `firestore.rules` and `storage.rules` |
| 7 | When rules aren't in the repo (secure-baseline has a Firebase config but no rules file) it gave a prose caveat only | The user needs a concrete dashboard checklist, and the report needs it under "worth a look", not as a severity | `db.write-unverified` (`unverified`, subject = platform) with click-by-click dashboard steps in `manual_steps`, raised only when the platform is actually used |
| 8 | Fix advice was prose ("add policies") without what may break | RLS changes are the riskiest fixes in the plugin: client queries that read other users' rows stop returning data | Every fix is `fix_risk: high`, and `may_break` lists the client queries found that read other users' rows; cookbook SQL and rules in `references/` |

## Not observed, but guarded anyway (from the brief)

- Flagging `using (true)` on intentionally public tables (products, posts): the skill says when that's fine and puts it under "what's already good" with the reason.
- Update policies that let users change `role` / `is_admin` / `plan` columns: the baseline fixture protects `plan` with column grants, and the skill names that as the correct pattern so it isn't reported.
- Vendor and build output: `node_modules`, `.next`, `dist` and lockfiles are excluded from search (search-scope rule).
