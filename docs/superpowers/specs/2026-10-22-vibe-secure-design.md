# vibe-secure — Design Spec

Date: 2026-10-22
Status: Draft for review
Name: `vibe-secure` is a placeholder until a final name is chosen.

## 1. Purpose

A Claude Code plugin of skills, based on OWASP best practices, that helps vibe coders find and fix security holes in their apps. Users are non-security people who may not fully understand their own code, so everything they see is in plain English.

### Success criteria

A non-expert runs one command on a typical Lovable / Bolt / v0 / Next.js + Supabase app and:

1. finds the real problems (leaked keys, open database rules, unverified webhooks, exposed AI keys),
2. understands what each problem means for them,
3. fixes them without breaking the app,
4. is not flooded with false alarms.

### Decisions made

| Decision | Choice |
|---|---|
| Audience | Other vibe coders (public, shareable) |
| Trigger | On demand only (slash commands) |
| Stacks | Popular vibe-coding stacks first, general fallback |
| Fix behavior | Report first, then fix with approval |
| Scope | Code analysis + safe, read-only live checks |
| Distribution | Claude Code plugin in a public GitHub repo |
| Structure | One orchestrator command + focused area skills, each runnable alone |

### Standards

- OWASP Top 10 (2025) for web app categories.
- OWASP Top 10 for LLM Applications for AI features.
- OWASP categories are cited in a sub-line of each finding, never as its headline.

### Target stacks (stack-specific checks)

Next.js / React (including Lovable, Bolt, v0 output), Supabase, Firebase / Firestore, Vercel / Netlify, Stripe, LLM APIs (OpenAI, Anthropic, others). Any other stack gets only the general checks.

### Out of scope (v1)

- Automatic triggers while coding
- CI or pre-deploy gates
- Stack-specific checks for non-JS backends (general fallback only)
- Mobile apps
- Any active, write or fuzz testing against live systems

## 2. Architecture

### Plugin layout

```
vibe-secure/
  .claude-plugin/plugin.json
  commands/security-check.md
  skills/
    security-check/SKILL.md          # orchestrator
    check-secrets/SKILL.md
    check-database-rules/SKILL.md
    check-auth/SKILL.md
    check-injection/SKILL.md
    check-payments/SKILL.md
    check-ai-features/SKILL.md
    check-config/SKILL.md
    check-dependencies/SKILL.md
    check-live/SKILL.md
    <skill>/references/*.md          # per-stack detail, loaded only when relevant
  shared/
    finding-format.md
    severity-guide.md
    stack-detection.md
  test-fixtures/
  docs/
```

### Area skills

| Skill | OWASP | Catches |
|---|---|---|
| `check-secrets` | A04, A02 | API keys in client code or git history; `service_role` key in the frontend; `.env` not gitignored |
| `check-database-rules` | A01 | Supabase RLS off or `using (true)` policies; open Firebase/Firestore rules; IDOR in API routes; write access (from the rules in the repo) |
| `check-auth` | A07 | Server routes without a user check; trusting user IDs or roles sent by the client; admin pages guarded only in the UI; weak session handling; no login rate limiting |
| `check-injection` | A05 | SQL built from strings; `dangerouslySetInnerHTML` with user data; `eval`; SSRF via user-supplied URLs |
| `check-payments` | A08 | Unverified Stripe webhooks; prices or amounts trusted from the client; subscription status set from the frontend |
| `check-ai-features` | LLM Top 10 | LLM keys in the browser; prompt injection reaching tools or data; no spending or rate caps on AI endpoints |
| `check-config` | A02, A09, A10 | CORS `*` with credentials; missing security headers; debug mode or stack traces in production; public source maps |
| `check-dependencies` | A03 | Known-vulnerable packages (`npm audit`); suspicious or typosquatted packages; missing lockfile |
| `check-live` | several | Read-only probes of the deployed URL (see Section 5) |

### Run flow

1. **Detect the stack.** Read `package.json`, config files and imports. Write `.vibe-secure/stack.json`, e.g. `{framework: "next", db: "supabase", payments: "stripe", ai: "openai", host: "vercel"}`.
2. **Confirm scope.** Show the detected stack. Ask for the deployed URL (optional) and an ownership confirmation.
3. **Run the relevant area skills.** Skip areas that don't apply. Each writes `.vibe-secure/findings/<area>.json`.
4. **Merge.** Remove duplicates (one issue with evidence from code and live = one finding), rank by severity, write `.vibe-secure/report.md`.
5. **Report and fix loop** (Section 4).

Running an area skill alone (e.g. `/check-secrets`) follows the same flow for that one area. It runs stack detection first if `stack.json` is missing.

`.vibe-secure/` is added to `.gitignore` automatically on first run, because findings can contain partial secrets.

## 3. Finding format

Defined in `shared/finding-format.md`. Every area skill writes findings in this format:

| Field | Description |
|---|---|
| `id` | `<area>-<n>` |
| `area` | skill name |
| `owasp` | e.g. `A01:2025` or `LLM01` |
| `severity` | `critical` / `high` / `medium` / `low` / `unverified` |
| `title` | plain-English consequence ("Anyone can read every user's email") |
| `impact` | what could happen, 1–2 sentences |
| `evidence` | list of `file:line` and/or `{url, status, summary}`; secrets masked |
| `fix_plan` | what will change, per stack |
| `fix_risk` | `low` / `high`, plus what might break |
| `manual_steps` | steps the user must do outside the code (key rotation, dashboard settings), or empty |
| `status` | `open` / `fixed` / `skipped` / `awaiting-user` |

Unconfirmed suspicions are written with `severity: "unverified"` and shown only in the "worth a look" list.

### Severity, from `shared/severity-guide.md`

- **Critical:** strangers can steal data, money or accounts right now with no skill required.
- **High:** an attacker with moderate skill could do serious damage.
- **Medium:** it makes other attacks easier or leaks something minor.
- **Low:** hardening and best practice.

## 4. Report and fix loop

### Report

Shown in chat and saved to `.vibe-secure/report.md`.

- Summary line with counts per severity.
- Findings ordered by severity. Each has a consequence headline, a short explanation, proof, the OWASP category, the fix and its risk.
- **No proof, no finding.** Every finding needs a `file:line` or a live request and response. Unproven items go in a separate "worth a look" list without severity colors.
- **Secrets are always masked** (`sk_live_4f…a9`).
- It ends with "what's already good" so users don't "fix" correct code.

### Fix loop

1. Ask: fix all critical issues now, go one at a time, or pick specific ones.
2. Before each fix, explain in 1–2 sentences what changes and what may behave differently.
3. **Low-risk fixes** (move a key to an env var, add headers, verify a webhook signature): approved once per batch.
4. **High-risk fixes** (RLS policies, auth changes, CORS tightening): approved one at a time. Before asking, Claude searches the code for anything the fix could break and reports what it found.
5. **Verify after each fix:** re-run that finding's check (and its live probe, if it came from one). It is `fixed` only if the check passes.
6. **Manual steps** (rotate a leaked key, purge git history, change a dashboard-only setting) are given as click-by-click instructions. A leaked key stays `awaiting-user` until the user confirms it was rotated.
7. Final summary: fixed, still open, and the user's manual to-do list.

## 5. Live check safety rules (`check-live`)

These are hard rules in the skill, not suggestions.

### Scope

- The user confirms the exact URL(s) and states they own the app and may test it.
- The only hosts contacted are that URL and backend hosts found in the code (e.g. `*.supabase.co`, `*.firebaseio.com`). Each extra host is listed for the user first.
- If the URL doesn't match the project's config, or looks like a third-party site, stop and ask.

### Allowed

- GET and HEAD requests only, including read-only Supabase/Firebase REST reads via GET.
- Only public credentials found in the shipped frontend (anon key, Firebase web config). Never the user's session, service-role keys or admin tokens.
- Every data read uses `limit=1` or the equivalent. Row counts come from headers where possible. Returned data is masked in the report and never stored.
- Sequential requests with a small delay. Hard cap of 50 requests per run.

### Forbidden

- POST / PUT / PATCH / DELETE, sign-ups, logins, uploads.
- Brute force, fuzzing, injection payloads, scanners.
- Any path outside the fixed list below.

### Probe list

- Homepage: security headers and cookie flags.
- CORS: a GET with a foreign `Origin` header.
- `/.env`, `/.git/HEAD`, `*.map` source maps.
- `/api` routes found in the code: do they return data without a session?
- Common debug endpoints, and error pages that leak stack traces.
- Supabase: tables and storage buckets found in the code, read with the anon key.
- Firebase/Firestore: paths and collections found in the code, read without auth.

### Write access

Live checks never test writes. `check-database-rules` checks write access from the policies and rules in the repo. If those rules aren't in the repo, the report says "couldn't verify write access" and gives a dashboard checklist.

### Transparency

Every request is logged to `.vibe-secure/live-requests.log`. The report states the total ("Made 23 read-only requests to 2 hosts").

## 6. Area skill template

Every `check-*` skill's `SKILL.md` has these sections:

1. **Frontmatter:** `name`, and a `description` starting "Use when auditing…".
2. **What this protects against:** 2–3 plain sentences plus the OWASP reference.
3. **Applies when:** the `stack.json` conditions.
4. **Checks:** a numbered list. For each: what to look for (files, patterns), how to confirm it's real, the severity rule, and per-stack notes.
5. **Fixes:** the safe pattern per stack with code, plus what might break.
6. **Not a finding:** known false positives. For example, the Supabase anon key and Firebase web config are meant to be public; only `service_role` or admin keys are leaks.

Long per-stack material lives in `references/` and is loaded only when that stack is detected.

## 7. Testing

### Fixtures (`test-fixtures/`)

Each fixture has an `expected-findings.json` and a basic smoke test.

| Fixture | Planted issues |
|---|---|
| `nextjs-supabase-leaky` | RLS off, `service_role` key in the client, unverified Stripe webhook, `dangerouslySetInnerHTML` with user input |
| `react-firebase-open` | Open Firestore rules, admin check only in the UI |
| `next-openai-chatbot` | OpenAI key exposed to the browser, no rate limit, prompt reaching a database tool |
| `secure-baseline` | The same features done correctly |

### Pass bar

- Every expected critical and high finding is detected in each leaky fixture.
- `secure-baseline` produces zero critical or high findings.
- After each fix, the finding's check passes and the fixture's smoke test still passes.
- `check-live` is tested only against fixtures served on `localhost` with a local Supabase instance, never against a real deployment.

### Method

Follow the writing-skills discipline: run each skill against its fixtures, record where Claude misses or over-reports, tighten the skill text, and repeat until it meets the pass bar.

## 8. Distribution

- Public GitHub repo containing the plugin and a marketplace manifest.
- Install: `/plugin marketplace add <owner>/vibe-secure`, then `/plugin install vibe-secure`.
- The README explains what it does, what live checks will and won't do, and that it does not replace a professional audit.
