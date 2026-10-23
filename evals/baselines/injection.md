# RED baseline: injection (no plugin)

Date: 2026-10-23. Prompt: `claude -p "Check this project for injection vulnerabilities: SQL injection, cross-site scripting (XSS), eval or code injection, and server-side request forgery (SSRF). Report only."`, run in a temp copy of each fixture (expected files and `history.sh` removed, git initialised with one commit), allowed tools `Read Grep Glob Bash(ls:*) Bash(cat:*) Bash(git:*)`, no `--plugin-dir`.

Fixtures: `nextjs-supabase-leaky`, `next-openai-chatbot`, `python-flask-generic`, and `secure-baseline` as the false-positive check.

## What plain Claude got right

- `nextjs-supabase-leaky`: found the stored XSS through `dangerouslySetInnerHTML` with a database value, and correctly said the Supabase query builder passes values as parameters (no SQL injection).
- `next-openai-chatbot`: found the SQL built from the model's tool-call argument and explained that the user steers the model, so the model is not a filter.
- `python-flask-generic`: found the f-string SQL and gave the right `?` placeholder fix.
- `secure-baseline`: no false positives. It saw that the `dangerouslySetInnerHTML` input goes through an escape function that encodes all five characters, and that no server fetch takes a URL from the request.

As in the other areas, the raw model spots the obvious problems. What it lacks is structure, scope discipline and consistent severity.

## Failures the skill must address

| # | Baseline behaviour | Why it matters | Skill rule that addresses it |
|---|---|---|---|
| 1 | No findings file, no stable check ids or subjects; free-form prose only | The orchestrator, merge, fix loop and scorer can't use it | Each check names its `check` id and `subject` (the function or tool name, `rpc:<function>`, the sink name, the route path); the file is always written (`findings: []` when clean) and validated |
| 2 | Scope creep in every vulnerable fixture: the service-role key, the committed `.env`, RLS off, the unsigned webhook, the client-set price, `lodash`, missing headers (leaky app); the browser OpenAI key, the committed `.env.local`, the agent route's missing login and rate limit (chatbot); debug mode and the hard-coded `SECRET_KEY` (Flask) | Duplicates other areas under different ids, so merge can't dedupe them | "Stay in this area" hands each one to its skill in one line, including the prompt-to-tool exposure (`check-ai-features`) and the missing login (`check-auth`) |
| 3 | Inconsistent severity: the XSS was "High, likely Critical in practice" because RLS was also off; both SQL injections were "critical" with no stated rule | Users can't compare runs; one area's finding shouldn't be inflated by another area's hole | Fixed rules: `inj.sql-string` high, critical only when the code runs on a route with no session check (check-auth's definition); `.or()`/`.filter()` strings medium; XSS high; eval critical on the server; SSRF high. Other areas' holes are mentioned in `impact`, not used to raise the severity |
| 4 | Subjects were whatever came to mind: "SQL injection in `/search`", "`app/api/agent/route.js:25-26`" | The scorer and merge match on `subject` | Per-check subject rules: the function, view or tool name holding the query (the tool name when the SQL is built from model tool arguments), the route path only for anonymous or verb-named handlers, the sink name for XSS and eval, the route path for SSRF |
| 5 | Fix advice was prose with no "what might break" | Replacing a model-written `WHERE` clause with typed parameters removes a feature; stripping HTML changes how bios look | Per-check `fix_risk` with `may_break`, and per-stack fix code in `references/injection-fixes.md` |
| 6 | Read `smoke.mjs` and discussed its `execFileSync` and `RegExp` as possible code injection | Test and developer scripts never see request data | "Not a finding" excludes test files, scripts and migrations that take no request data |

## Not observed, but guarded anyway (from the brief)

- Flagging Prisma `$queryRaw` tagged templates, the Drizzle `sql` tag, `pg` `$1` parameters, Python `execute("… %s", (x,))` parameter tuples or the Supabase query builder as SQL injection: listed under "Not a finding", with the unsafe look-alikes (`$queryRawUnsafe`, `sql.raw`, `%` formatting) spelled out.
- Flagging React `{value}` as XSS: React escapes it; only the raw-HTML sinks, `javascript:` URLs in `href`/`src` and server templates with escaping turned off count.
- Flagging browser-side `fetch` of a user URL as SSRF: only server code counts.
- Vendor and build output: `node_modules`, `.next`, `dist` and lockfiles are excluded from search (search-scope rule).
