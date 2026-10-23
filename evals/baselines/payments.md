# RED baseline: payments (no plugin)

Date: 2026-10-23. Prompt: `claude -p "Check this project's Stripe payment code for security problems: webhook signature verification, prices or amounts taken from the client, and plans, subscriptions or credits granted without a verified payment. Report only."`, run in a temp copy of each fixture (expected files and `history.sh` removed, git initialised with one commit), allowed tools `Read Grep Glob Bash(ls:*) Bash(cat:*) Bash(git:*)`, no `--plugin-dir`. Model forced with `ANTHROPIC_MODEL=claude-opus-4-8` because the user-level `model` setting is rejected in headless runs.

Fixtures: `nextjs-supabase-leaky`, and `secure-baseline` as the false-positive check.

## What plain Claude got right

- `nextjs-supabase-leaky`: found the webhook that `JSON.parse`s the body with no `constructEvent`, and the checkout that takes `unit_amount` from the request body. Also noticed that the webhook grants `pro` for any completed checkout without checking `payment_status` or what was bought.
- `secure-baseline`: no false positives. It saw the raw body verified with `constructEvent` before any logic, the server-side price lookup, the fulfilment gated on `payment_status === 'paid'`, and the plan taken from server-written metadata.

As in the other areas, the raw model finds the obvious holes. What it lacks is structure, scope discipline and consistent severity.

## Failures the skill must address

| # | Baseline behaviour | Why it matters | Skill rule that addresses it |
|---|---|---|---|
| 1 | No findings file, no check ids, free-form subjects ("`app/api/checkout/route.js:6-12`") | The orchestrator, merge, fix loop and scorer can't use it | Each check names its `check` id and its subject (the webhook route path; the checkout route path or `action:<fn>`; the route, action, page or table that writes the plan); the file is always written (`findings: []` when clean) and validated |
| 2 | The client-set price was "CRITICAL" | Severity must be stable: a buyer has to edit a request, which the severity guide's payments row puts at high | `pay.client-price` is `high`, with the reason stated |
| 3 | Reported "plan granted with no verified payment" as a third critical finding whose cause was the same missing signature check, then mixed in the missing `payment_status` check | One root cause, one finding; the fulfilment flaw survives the signature fix and needs its own, lower severity | Check 1 says the unverified webhook is one finding; fulfilment problems are a separate check-3 finding at their own severity (`high` for granting a fixed plan on any checkout, `medium` for no `payment_status` check), never raised to critical because the webhook is unverified |
| 4 | Scope creep: the service-role key in the browser, RLS off on `profiles`, the committed `sk_live_` key, the stored XSS, and the checkout route's missing login | Duplicates other areas under different ids, so merge can't dedupe them | "Stay in this area" hands each to its skill in one line (`check-secrets`, `check-database-rules`, `check-injection`, `check-auth`) |
| 5 | Fix advice was prose with no "what might break" and no setup step for the signing secret | The webhook fix fails in production until the secret is set; a server-side catalog stops unknown products selling | Per-check `fix_risk`/`may_break`, `manual_steps` for the signing secret, and per-stack code in `references/payments-fixes.md` |

## Not observed, but guarded anyway (from the brief and dispatch)

- Flagging `pk_` publishable keys or a client price id checked against a server allowlist: listed under "Not a finding".
- The subtler webhook failures: verification whose `catch` carries on, a webhook secret in a public env variable, `constructEvent` on a body Next.js Pages Router or `express.json()` already parsed, and `constructEvent` (not `constructEventAsync`) in Supabase Edge Functions: all listed as check-1 cases with their own severity.
- Success pages that grant access from `?paid=true` or an unchecked `session_id`, and browser code writing `plan`/`credits` directly: check-3 cases, critical.
- Baseline also noted missing event-id deduplication on secure-baseline as "not exploitable"; the skill lists it under "Not a finding" when the grant sets a fixed value.
