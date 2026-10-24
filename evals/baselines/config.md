# RED baseline: config (no plugin)

Date: 2026-10-23. Prompt: `claude -p "Check this project's configuration for security problems (OWASP A02 Security Misconfiguration, A09 Logging, A10 Exceptional Conditions): missing security headers (CSP, X-Frame-Options, HSTS), CORS that allows any origin with credentials, debug mode or stack traces/error messages returned in production, logging of secrets, and public source maps. Report only."`, run in a temp copy of each fixture (expected files and `history.sh` removed, git initialised with one commit), allowed tools `Read Grep Glob Bash(ls:*) Bash(cat:*) Bash(git:*)`, no `--plugin-dir`. Model forced with `ANTHROPIC_MODEL=claude-opus-4-8` because the user-level `model` setting is rejected in headless runs.

Fixtures: `nextjs-supabase-leaky`, `python-flask-generic`, and `secure-baseline` as the false-positive check.

## What plain Claude got right

- `nextjs-supabase-leaky`: saw that `next.config.js` sets no headers, that source maps are off by default and that there is no CORS config.
- `python-flask-generic`: saw `debug=True` with `host="0.0.0.0"` and explained the Werkzeug console; no CORS, no source maps.
- `secure-baseline`: found every header, no CORS, a generic error reply in the webhook and no secret logging. No vulnerabilities reported.

## Failures the skill must address

| # | Baseline behaviour | Why it matters | Skill rule that addresses it |
|---|---|---|---|
| 1 | No findings file, no check ids, free-form subjects | The orchestrator, merge, fix loop, live confirmation and scorer can't use it | Each check names its `check` id and subject (route path or config file name; the debug setting as written); the file is always written (`findings: []` when clean) and validated |
| 2 | Missing headers rated **High** (Next.js app) | The severity guide puts missing headers at low; inflated severities bury the real problems | `cfg.missing-headers` is `low`, `medium` only when the app has a login; one finding per app listing which headers are missing |
| 3 | Debug on `0.0.0.0` rated **Critical** | The Werkzeug console is PIN-protected; critical is for "no skill required" | `high` when the debugger is reachable from other machines, `critical` only when the PIN is off or an admin/debug console is public with no login |
| 4 | Same root cause split: "debug mode" plus "unhandled exceptions surface a stack trace" (Flask) | Two findings for one setting; the second goes away with the first | "One root cause is one finding": error pages that only appear because of debug mode belong to the debug finding |
| 5 | Reported "no try/catch" in a Next.js route (Medium) and "no logging at all" (Low, A09) | Next.js already returns a plain 500 in production; absence of logging can't be proven or fixed specifically | "Not a finding": framework defaults that hide details, and no logging/monitoring at all |
| 6 | Scope creep: service_role key, RLS, committed `.env`, webhook signature, client price, hard-coded `SECRET_KEY`, SQL injection, lodash, XSS reported inside the config report | Duplicates `check-secrets`, `check-database-rules`, `check-payments`, `check-injection`, `check-dependencies` | "Stay in this area" hands each off in one line, no finding |
| 7 | `secure-baseline`: listed a local address in CSP `connect-src` and `style-src 'unsafe-inline'` as observations | Correct configs flagged as smells train users to "fix" them | "Not a finding": a CSP that exists but isn't perfect (`style-src 'unsafe-inline'`, dev addresses, broad `img-src`) |
| 8 | No fix code, no rollout advice, no "what might break" | Enforcing a CSP right away can break the site's own scripts | `references/headers.md` gives a block per host with CSP in report-only mode (`fix_risk: high`, "may block scripts from other sites"); `references/config-fixes.md` covers CORS, debug, errors, logs, source maps |

## Not observed, but guarded anyway (from the brief and dispatch)

- CORS that echoes the origin (`origin: true`, Flask-CORS/FastAPI with `*` plus credentials) and the literal-`*`-with-credentials case.
- Supabase Edge Function `corsHeaders` with `*` and no credentials: not a finding.
- Hosting defaults: Vercel and Netlify add HSTS, so missing HSTS there is not a finding.
- `error.message` or raw exceptions returned from API routes, Express handlers sending `err.stack`, tokens or whole request headers in server logs.
- Source maps: Next.js `productionBrowserSourceMaps`, Vite `build.sourcemap: true` (not `hidden`), Create React App's default.
