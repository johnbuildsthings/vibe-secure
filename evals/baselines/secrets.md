# RED baseline: secrets (no plugin)

Date: 2026-10-22. Prompt: `claude -p "Find leaked secrets and API keys in this project. Report only."`, run in a temp copy of each fixture (git initialised, `history.sh` replayed for `nextjs-supabase-leaky`), allowed tools `Read Grep Glob Bash(node:*) Bash(git:*) Bash(ls:*) Bash(cat:*)`, no `--plugin-dir`.

`secure-baseline` was also run as a false-positive check. The brief asked only for the two leaky fixtures.

## What plain Claude got right

- `nextjs-supabase-leaky`: found the `service_role` key behind `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` used by the browser client, the tracked `.env`, and the `sk_live_HIST…` key that exists only in git history (commit `635c9ad`). It decoded the JWT and saw `"role":"service_role"`.
- `next-openai-chatbot`: found `NEXT_PUBLIC_OPENAI_API_KEY` used in a `'use client'` file, and the tracked `.env.local` (there is no `.gitignore`).
- `secure-baseline`: no false positives. It recognised the anon JWT (`role: anon`), the Firebase web `apiKey` and the blank `.env.example` as safe.

So the raw model rarely misses an obvious leak. What it lacks is structure, consistency and safety in how it reports.

## Failures the skill must address

| # | Baseline behaviour | Why it matters | Skill rule that addresses it |
|---|---|---|---|
| 1 | No findings file, no stable check ids or subjects; free-form prose only | The orchestrator, merge, fix loop and scorer can't use it | Checks 1–4 each name their `check` id and `subject`; the file is always written (`findings: []` when clean) and validated |
| 2 | Printed a secret in full: `postgres://app:fakepassword@…` (openai fixture) and a partial key without the standard masking | A report that gets pasted into chat or an issue leaks the key again | "Masking" section: every value goes through `maskSecret`; connection-string passwords count as secrets; `validate-findings` must pass |
| 3 | Dismissed or hedged on keys because they "look like placeholders" (`FAKE…`, "if the values were ever real", Firebase key "is a placeholder anyway") | On a real app a hedge reads as "probably fine" and the user skips rotation | "Never decide a key is fake from its text"; only empty values and obvious placeholders (`your-key-here`, `xxx`, `<…>`, `changeme`) are skipped |
| 4 | Inconsistent severity: "`.env` committed" was **Critical** in one run, and the server route using the `NEXT_PUBLIC_` key was "Medium" | Users can't compare runs or fixtures | Fixed severity rules per check (env-not-ignored = high; history = high, critical for `sk_live_`/service_role; client exposure = critical, `sk_test_` = high) |
| 5 | Scope creep: reported RLS, the Stripe webhook and SQL injection inside a secrets run | Duplicates other area skills, and merge can't dedupe them because the check ids differ | "Stay in your area": other problems get one line in the reply, not a finding |
| 6 | Generic rotation advice ("rotate the keys", "git filter-repo or BFG, then force-push") listed as equals, without clicks | Vibe coders can't act on it, and purging history without rotating leaves the key valid | `references/rotation-steps.md`: click-by-click rotation per provider; the purge is optional and comes after rotation |
| 7 | The key found only in history was not separated from fixable code issues | The fix loop would mark it "fixed" after a code edit, though the key is still leaked | `secrets.key-in-git-history` is always `awaiting-user`, never `fixed` by Claude |
| 8 | Tracked `.env` keys and their current-file exposure were bundled into one item | One finding mixes a code fix (untrack, ignore) with a manual step (rotate) | Separate checks: `env-not-ignored` (the file) vs `key-in-git-history` (each key value committed) |

## Not observed, but guarded anyway (from the brief and spec)

- Flagging public keys: Supabase anon / `sb_publishable_`, Firebase web `apiKey`, Stripe `pk_`. The baseline got these right, but `AIza…` is shared by Firebase (public) and Google AI (secret), so the skill spells out how to tell them apart.
- Vendor and build output: `node_modules`, `.next`, `dist` and lockfiles are excluded from search (search-scope rule).
- Search tools that skip hidden or gitignored files: `.env*` files are listed with `ls -a` and read directly, because an ignored `.env.local` can still hold a `NEXT_PUBLIC_` server key that ships in the build.
