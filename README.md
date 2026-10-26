# vibe-secure

A Claude Code plugin that helps you find and fix security holes in your app. It checks for the most common problems in vibe-coded projects—leaked API keys, open database rules, missing login checks, payment bugs, AI feature risks, and more—then explains each finding in plain English and walks you through fixing them safely. Based on OWASP best practices, built for people who may not fully understand their own code yet.

## Install

```bash
/plugin marketplace add <owner>/vibe-secure
/plugin install vibe-secure@vibe-secure
```

## Usage

All skills run only when you type the slash command. The plugin will never run automatically.

### Full audit

```bash
/vibe-secure:security-check
```

Runs the complete security audit covering all nine areas below, then shows a plain-English report and offers to walk you through fixing what it found. You can optionally include read-only checks of your deployed site.

### Individual checks

Each area can be run on its own:

- **`/vibe-secure:check-secrets`** — Finds leaked or exposed API keys and secrets, such as server keys shipped to the browser, secrets hard-coded in the code, .env files that aren't gitignored, and keys still in git history.

- **`/vibe-secure:check-database-rules`** — Checks for database access holes, such as Supabase tables with row level security off, policies that let anyone read or change every row, open Firebase security rules, and API routes that return any record by id without checking who owns it.

- **`/vibe-secure:check-auth`** — Audits login and session handling, such as API routes or server actions with no login check, code that trusts a user id or role sent by the browser, admin screens hidden only in the UI, custom login forms with no rate limit, and session cookies or tokens stored unsafely.

- **`/vibe-secure:check-injection`** — Looks for injection holes, such as SQL built by pasting in request data or AI tool arguments, user or database content rendered as raw HTML, eval or shell commands run on request data, and server code that fetches a URL the visitor chose.

- **`/vibe-secure:check-payments`** — Audits payment handling with Stripe for money holes, such as webhooks that don't check Stripe's signature, checkout routes that take the price from the browser, and plans, subscriptions or credits granted from data the buyer controls instead of a verified payment.

- **`/vibe-secure:check-ai-features`** — Checks your app's AI features (OpenAI, Anthropic, Gemini, Vercel AI SDK, LangChain) for holes, such as browser code calling the AI provider directly, user prompts steering a model that can call powerful tools, AI endpoints anyone can call with no login, rate limit or token cap, and model output run as code or rendered by a markdown renderer with raw HTML turned on.

- **`/vibe-secure:check-config`** — Reviews configuration for holes, such as missing security headers (Content-Security-Policy, X-Frame-Options, HSTS), CORS that lets any site call your API with the visitor's cookies, debug mode or stack traces and raw error messages reaching visitors, secrets or tokens written to logs, and source maps published with the production site.

- **`/vibe-secure:check-dependencies`** — Audits third-party packages for supply-chain risk, such as npm packages with known vulnerabilities (npm audit), look-alike or suspicious packages that run install scripts, dependencies pulled from git URLs or unknown hosts, and missing, gitignored or out-of-date lockfiles (including unpinned Python requirements).

- **`/vibe-secure:check-live`** — Tests your deployed site with safe, read-only requests to confirm what the code checks found (database tables anyone can read, missing security headers, loose CORS, public source maps, stack traces, API routes that answer without a login) and to catch what only shows live, such as a public /.env or /.git folder.

## What live checks will and won't do

When you provide a deployed URL, `check-live` runs safe, read-only probes to confirm code findings and catch issues that only appear in production.

### Scope

- You confirm the exact URLs and state that you own the app and may test it.
- The only hosts contacted are that URL and backend hosts found in the code (for example, `*.supabase.co`, `*.firebaseio.com`). Each extra host is listed for you first.
- If the URL doesn't match your project's config, or looks like a third-party site, the check will stop and ask.

### Allowed

- GET and HEAD requests only, including read-only Supabase and Firebase REST reads via GET.
- Only public credentials found in the shipped frontend (anon key, Firebase web config). Never your session, service-role keys or admin tokens.
- Every data read uses `limit=1` or the equivalent. Row counts come from headers where possible. Returned data is masked in the report and never stored.
- Sequential requests with a small delay. Hard cap of 50 requests per run.

### Forbidden

- POST, PUT, PATCH, DELETE requests, sign-ups, logins, uploads.
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

Every request is logged to `.vibe-secure/live-requests.log`. The report states the total (for example, "Made 23 read-only requests to 2 hosts").

## Important

**This plugin does not replace a professional security audit.** It catches common problems in typical vibe-coded projects, but a real audit by security experts will find more. Use this to fix the obvious holes, then consider hiring professionals for anything handling sensitive data or payments.

## Contributing

To add a new check:

1. **Write the skill** using the template at `shared/area-skill-template.md`. Follow the format of existing `check-*` skills.

2. **Add a test fixture expectation** to the appropriate fixture's `expected-findings.json` in `test-fixtures/<fixture>/`. See `test-fixtures/README.md` for the format.

3. **Run the eval** to verify your check works:
   ```bash
   bash evals/run-eval.sh <fixture> <area>
   ```
   For example:
   ```bash
   bash evals/run-eval.sh nextjs-supabase-leaky secrets
   ```

4. **Run the full test suite** before submitting:
   ```bash
   npm test
   ```

The eval runs your skill against a copy of the fixture in a headless Claude session, then scores the findings against what was expected. Exit code 0 means it passed.

## License

MIT License - see LICENSE file for details.
