# vibe-secure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin that runs an on-demand, OWASP-based security audit of vibe-coded apps, reports findings in plain English, and fixes them with the user's approval.

**Architecture:** Markdown skills hold the judgment: one `security-check` orchestrator and nine `check-*` area skills. Small dependency-free Node scripts hold everything that must be deterministic or enforced: stack detection, workspace setup, finding validation and merging, secret masking, and the read-only `safe-fetch` used by every live probe. Skills are tested by running headless `claude -p` against deliberately vulnerable fixture apps and scoring the findings files against each fixture's `expected-findings.json`.

**Tech Stack:** Claude Code plugin (skills + `.claude-plugin` manifests), Node ≥ 20 ESM scripts with no npm dependencies, `node --test`, bash for the eval runner.

**Spec:** `docs/superpowers/specs/2026-10-22-vibe-secure-design.md`

## Global Constraints

- Plugin name `vibe-secure` (placeholder). Plugin root = repo root.
- Skills are on demand only: every `SKILL.md` frontmatter sets `disable-model-invocation: true`.
- Scripts: Node ≥ 20, ESM (`.mjs`), Node built-ins only. Each script exports its functions and has a CLI guarded by `import.meta.url === pathToFileURL(process.argv[1]).href`.
- Severity values: `critical` | `high` | `medium` | `low` | `unverified`. Rank order is critical > high > medium > low > unverified.
- Severity meanings come verbatim from spec §3. Critical: "strangers can steal data, money or accounts right now with no skill required."
- Finding headlines state consequences in plain English. The OWASP id goes only in the `owasp` field and its report sub-line.
- Secrets are always masked (`sk_live_4f…a9`), in the report, findings files and logs.
- Live probes: GET/HEAD only, allowlisted hosts only, max 50 requests per run, sequential with a 500 ms delay, `limit=1` on data reads, response bodies never written to disk.
- Workspace dir `.vibe-secure/` inside the audited project. It is always added to that project's `.gitignore`.
- Plain-English tone everywhere a user reads text: no unexplained jargon, and second person ("your app").

### Spec refinements (made while planning; flag in review)

1. **Two finding fields added:** `check` (a stable check id such as `db.rls-disabled`) and `subject` (the thing affected, such as a table name, route or masked key). The scorer and merge need them. Merge dedupes on `check` + `subject`. When a live probe confirms a code finding, it emits the code finding's `check` id, so the two merge into one finding with two pieces of evidence.
2. **`commands/` dropped.** Plugin skills are already slash-invocable as `/vibe-secure:security-check` and `/vibe-secure:check-*`, so a same-named command would collide.
3. **`stack.json` holds an `apps` array** (monorepo support), and `db`, `payments` and `ai` are arrays.
4. **Live tests use a Node mock** of the app plus Supabase's PostgREST endpoints (`test-fixtures/live-mock/`) instead of a local Supabase instance, which needs Docker. The mock also records any request that breaks the safety rules.
5. **LLM keys in the browser** are reported by `check-secrets` (`secrets.server-key-in-client`), the single owner of key leaks. `check-ai-features` instead reports `ai.client-side-llm-call` (the browser calling the provider directly).
6. **`secure-baseline` exempts `deps.known-vuln`** from its zero-critical/high rule, because advisories change daily. Known-vuln detection is pinned on the leaky fixture instead.

## Review Focus

1. **Monorepo or app in a subfolder** (`apps/web/package.json`, no root `package.json`): detect-stack must find every app, and the audit must cover them all. Pinned in Task 2.
2. **Unrecognized stack** (plain Express, Python/Flask): the audit still runs the general checks and says plainly that stack-specific checks were skipped, with no crash and no empty report. Pinned in Task 2 (detect-stack) and Task 16 (orchestrator eval on `python-flask-generic`).
3. **Live target redirects off-scope** (`https://app.com` → `https://login.otherco.com`), or is given with a path or trailing slash: safe-fetch must normalize scope and never follow a redirect to an unlisted host. Pinned in Task 4.
4. **Build output and dependencies in the tree** (`node_modules/`, `.next/`, `dist/`): these must be excluded from detection and scanning, or the audit drowns in vendor-code false positives. Pinned in Task 2 and in the "Search scope" rule of the Task 7 template.
5. **Key removed from the code but still in git history:** it must still be reported, as `awaiting-user` with rotation steps, because deleting the line doesn't un-leak the key. Pinned in Task 5 (`history.sh`) and Task 7.

---

## File Structure

```
.claude-plugin/plugin.json            plugin manifest
.claude-plugin/marketplace.json       single-plugin marketplace
skills/security-check/SKILL.md        orchestrator
skills/check-<area>/SKILL.md          nine area skills (+ references/*.md)
shared/finding-format.md              finding schema (human-readable)
shared/severity-guide.md              severity rules + plain-English examples
shared/stack-detection.md             what stack.json fields mean
shared/area-skill-template.md         section template every check-* follows
scripts/validate-findings.mjs         schema validation
scripts/detect-stack.mjs              writes .vibe-secure/stack.json
scripts/init-workspace.mjs            creates .vibe-secure/, updates .gitignore
scripts/merge-findings.mjs            dedupe + rank → merged.json
scripts/mask.mjs                      secret/PII masking
scripts/safe-fetch.mjs                the only HTTP client live checks may use
tests/*.test.mjs                      node:test unit tests for scripts
test-fixtures/<fixture>/              vulnerable sample apps + expected-findings.json
test-fixtures/live-mock/server.mjs    mock app + PostgREST for check-live
evals/run-eval.sh                     headless claude run against a fixture
evals/score-run.mjs                   scores findings vs expected
evals/baselines/<area>.md             RED baseline notes per area skill
README.md
```

---

### Task 1: Scaffold, manifests, finding schema + validator

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `package.json`, `shared/finding-format.md`, `scripts/validate-findings.mjs`
- Modify: `.gitignore` (add `evals/results/`, `node_modules/`)
- Test: `tests/validate-findings.test.mjs`

**Interfaces:**
- Produces:
  - `SEVERITIES = ['critical','high','medium','low','unverified']`, `severityRank(s: string) -> number` (critical=4 … unverified=0, unknown=-1)
  - `validateFinding(f: object) -> string[]` (error messages; empty = valid)
  - `validateFindingsFile(doc: object) -> string[]`
  - CLI: `node scripts/validate-findings.mjs <file.json>...` exits 1 and prints errors on any invalid file.
  - Findings file shape: `{ area: string, generated_at: ISO string, mode: "audit"|"verify", findings: Finding[] }`
  - Finding: `{ id, check, subject, area, owasp, severity, title, impact, evidence: Evidence[], fix_plan: string, fix_risk: {level:"low"|"high", may_break:string}, manual_steps: string[], status: "open"|"fixed"|"skipped"|"awaiting-user" }`
  - Evidence: `{file: string, line: number}` or `{url: string, status: number, summary: string}`

- [ ] **Step 1:** Write `package.json` (`{"name":"vibe-secure","private":true,"type":"module","engines":{"node":">=20"},"scripts":{"test":"node --test tests/"}}`), `plugin.json` (`name`, `version: "0.1.0"`, `description`, `author: {name: "John Andersen"}`, `license: "MIT"`) and `marketplace.json` (`name: "vibe-secure"`, `owner`, `plugins: [{name: "vibe-secure", source: "./", description}]`).
- [ ] **Step 2: Write failing tests** in `tests/validate-findings.test.mjs`:
  - a complete valid finding → `[]`
  - missing `check` → error mentioning `check`
  - `severity: "severe"` → error mentioning `severity`
  - `evidence: []` with severity `high` → error ("no proof, no finding"); `evidence: []` with `unverified` → `[]`
  - evidence `{file:"a.js"}` without `line` → error
  - `id` not matching `^[a-z-]+-\d+$` → error
  - `fix_risk.level: "medium"` → error
  - a finding whose `title`/`impact`/`summary` contains an unmasked `sk_live_` + 20 alphanumerics, or `eyJ…` with `"role":"service_role"` base64 segment → error mentioning "unmasked secret" (checked with `SECRET_PATTERNS`, defined here and imported by Task 4)
  - `severityRank('critical') > severityRank('high')`, and `severityRank('nope') === -1`
- [ ] **Step 3:** Run `npm test`. Expected: FAIL (module not found).
- [ ] **Step 4:** Implement `scripts/validate-findings.mjs`. Export `SECRET_PATTERNS: RegExp[]` (Stripe `sk_(live|test)_[A-Za-z0-9]{16,}`, `rk_live_…`, OpenAI `sk-(proj-)?[A-Za-z0-9_-]{20,}`, Anthropic `sk-ant-[A-Za-z0-9_-]{20,}`, Google `AIza[0-9A-Za-z_-]{35}`, AWS `AKIA[0-9A-Z]{16}`, a JWT whose decoded payload has `"role":"service_role"`). Task 4 reuses it.
- [ ] **Step 5:** Write `shared/finding-format.md`: the schema above as a table plus one complete example finding (RLS-off on `profiles`, as in the spec report sample), and the rule that `unverified` findings may have empty evidence and appear only under "worth a look".
- [ ] **Step 6:** Run `npm test`. Expected: PASS.
- [ ] **Step 7:** Commit: `git commit -m "feat: plugin scaffold and finding schema validator"`.

---

### Task 2: Stack detection

**Files:**
- Create: `scripts/detect-stack.mjs`, `shared/stack-detection.md`
- Test: `tests/detect-stack.test.mjs` (builds temp dirs with `fs.mkdtempSync`)

**Interfaces:**
- Produces:
  - `detectStack(root: string) -> { root: string, apps: App[] }`
  - App: `{ path: string /* relative, "." for root */, language: "js"|"python"|"other", framework: "next"|"remix"|"sveltekit"|"react-vite"|"express"|"unknown", db: string[], payments: string[], ai: string[], host: "vercel"|"netlify"|"firebase"|"unknown", generator: "lovable"|"bolt"|null }`
  - CLI: `node scripts/detect-stack.mjs <root>` writes `<root>/.vibe-secure/stack.json` (pretty JSON) and prints it.

Detection rules (from `dependencies` + `devDependencies` and files in the app dir):
- framework: `next` → next; any `@remix-run/` → remix; `@sveltejs/kit` → sveltekit; `vite` + `react` → react-vite; `express` → express; otherwise unknown.
- db: `@supabase/supabase-js` or `@supabase/ssr` or a `supabase/` dir → `supabase`; `firebase`/`firebase-admin` or `firebase.json` or `firestore.rules` → `firebase`; `@prisma/client` → `prisma`; `drizzle-orm` → `drizzle`; `mongodb`/`mongoose` → `mongodb`.
- payments: `stripe` or `@stripe/stripe-js` → `stripe`.
- ai: `openai` → `openai`; `@anthropic-ai/sdk` → `anthropic`; `@google/generative-ai`/`@google/genai` → `google`; `ai` → `vercel-ai`.
- host: `vercel.json` or `.vercel/` → vercel; `netlify.toml` → netlify; `firebase.json` containing `"hosting"` → firebase.
- generator: `lovable-tagger` dep → lovable; `.bolt/` dir → bolt; otherwise null (v0 output can't be told apart reliably).
- App discovery: every dir up to depth 3 containing `package.json`, `pyproject.toml` or `requirements.txt`. Skip `node_modules`, `.next`, `dist`, `build`, `out`, `.git`, `.vercel`, `.netlify`, `.vibe-secure`, `coverage`. A Python app gets `language: "python"`, `framework: "unknown"` and empty arrays.

- [ ] **Step 1: Write failing tests:**
  - root `package.json` with `next`, `@supabase/supabase-js`, `stripe`, `openai` plus `vercel.json` → one app `{path:".", framework:"next", db:["supabase"], payments:["stripe"], ai:["openai"], host:"vercel"}`
  - `vite` + `react` + `firebase` + `firebase.json` with hosting → react-vite, `["firebase"]`, host firebase
  - **monorepo:** no root `package.json`; `apps/web/package.json` (next) and `apps/api/package.json` (express) → two apps with paths `apps/web` and `apps/api`
  - **build dirs ignored:** `node_modules/x/package.json` and `.next/package.json` produce no apps
  - **unknown stack:** only `requirements.txt` → one app `{language:"python", framework:"unknown", db:[]}`
  - empty dir → `{apps: []}`
  - `lovable-tagger` dep → generator `"lovable"`
  - CLI writes `.vibe-secure/stack.json` equal to `detectStack` output
- [ ] **Step 2:** Run `node --test tests/detect-stack.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement `detectStack` per the rules above.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Write `shared/stack-detection.md`: each field and its values, and how skills use them (an area skill applies when its "Applies when" condition holds for at least one app, and runs per app).
- [ ] **Step 6:** Commit: `feat: stack detection`.

---

### Task 3: Workspace init and finding merge

**Files:**
- Create: `scripts/init-workspace.mjs`, `scripts/merge-findings.mjs`
- Test: `tests/init-workspace.test.mjs`, `tests/merge-findings.test.mjs`

**Interfaces:**
- Consumes: `validateFindingsFile`, `severityRank` (Task 1)
- Produces:
  - `initWorkspace(root: string, {full: boolean}) -> void`. Creates `.vibe-secure/findings/`. Appends `.vibe-secure/` to `<root>/.gitignore` if no line equals `.vibe-secure/` or `.vibe-secure`: creates the file if missing, and adds a newline first if the file doesn't end with one. With `full: true` it deletes `findings/*.json`, `merged.json`, `report.md`, `live-requests.log` and `live-scope.json`. CLI: `node scripts/init-workspace.mjs <root> [--full]`.
  - `mergeFindings(docs: FindingsFile[]) -> { findings: Finding[], worth_a_look: Finding[], counts: {critical,high,medium,low} }`. CLI: `node scripts/merge-findings.mjs <root>` reads `<root>/.vibe-secure/findings/*.json`, skips and warns on invalid files, and writes `<root>/.vibe-secure/merged.json`.
  - Merge rules: group by `check` + `subject.trim().toLowerCase()`. The merged finding keeps the highest severity, concatenates evidence (deduped by JSON string), unions `manual_steps`, keeps `fix_risk` with level `high` if any is high, keeps status `awaiting-user` if any has it, otherwise the first status, and keeps the first finding's `id`. Sort by severity rank descending, then `area`, then `id`. `unverified` goes into `worth_a_look`.

- [ ] **Step 1: Write failing tests:**
  - init on a dir without `.gitignore` → file is `.vibe-secure/\n`
  - init twice → `.vibe-secure/` appears exactly once
  - existing `.gitignore` `node_modules` (no trailing newline) → `node_modules\n.vibe-secure/\n`
  - `full: true` removes a pre-existing `findings/secrets.json` and `report.md`; `full: false` keeps them
  - merge: a code finding (`db.rls-disabled`, subject `profiles`, high, file evidence) plus a live finding (same check, subject `Profiles`, critical, url evidence) → one finding, severity critical, 2 evidence items
  - merge: an `unverified` finding lands in `worth_a_look` and isn't counted
  - merge: ordering is critical before high before medium; counts are correct
  - merge: one `fix_risk.level` high and one low → high
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement both modules.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: workspace init and finding merge`.

---

### Task 4: Masking and safe-fetch

**Files:**
- Create: `scripts/mask.mjs`, `scripts/safe-fetch.mjs`
- Test: `tests/mask.test.mjs`, `tests/safe-fetch.test.mjs` (uses a `node:http` server on an ephemeral port)

**Interfaces:**
- Consumes: `SECRET_PATTERNS` (Task 1)
- Produces:
  - `maskSecret(s: string) -> string`: keeps the first `min(10, floor(len/3))` chars + `…` + the last 2. Strings shorter than 12 → `••••`.
  - `maskText(text: string) -> string`: masks every `SECRET_PATTERNS` match and every JWT (`eyJ[\w-]+\.[\w-]+\.[\w-]+`) via `maskSecret`, and emails to `j***@example.com` (first char of the local part).
  - Scope file `<root>/.vibe-secure/live-scope.json`: `{ hosts: string[] /* "host:port" or "host" */, confirmed_by_user: true, confirmed_at: ISO }`
  - `safeFetch(url: string, opts: {root: string, method?: "GET"|"HEAD", headers?: Record<string,string>}) -> Promise<{status, headers, body_preview, bytes, redirect_location?}>`
  - CLI: `node scripts/safe-fetch.mjs --root <dir> [--method HEAD] [--header "Name: value"]... <url>` prints the result as JSON. On refusal it prints `{"refused": "<reason>"}` and exits 2.

safe-fetch rules (each refusal reason is a fixed string, used by the tests):
- `"no-scope"`: scope file missing or `confirmed_by_user !== true`
- `"method-not-allowed"`: method other than GET/HEAD
- `"host-not-in-scope"`: URL `host` (host:port, lowercase) not in `hosts`
- `"request-cap"`: `live-requests.log` already has 50 lines
- `"unbounded-read"`: path contains `/rest/v1/` without `limit=1`; host `firestore.googleapis.com` without `pageSize=1`; path ends `.json` on a `firebaseio.com`/`firebasedatabase.app` host without `shallow=true`
- Redirects: `redirect: "manual"`. Return the status and `redirect_location`, and never follow.
- Waits 500 ms before each request. Request timeout is 10 s.
- `body_preview` = `maskText` of the first 2048 chars. The body is never written to disk.
- Appends one log line per sent request: `ISO\tMETHOD\tURL\tSTATUS\tBYTES`. Refused requests aren't sent or counted.

- [ ] **Step 1: Write failing tests:**
  - `maskSecret('sk_live_4f' + 'X'.repeat(40) + 'a9') === 'sk_live_4f…a9'`; `maskSecret('short') === '••••'`
  - `maskText` on text containing an email and a Stripe key → neither appears in full
  - each refusal reason above has its own test, and none of them hits the test server (server request count stays 0)
  - GET to an in-scope test server → status 200, a log line appended, `body_preview` with secrets masked
  - **redirect off-scope:** server returns 302 to `http://evil.example/` → result status 302 with `redirect_location`, and the server receives exactly 1 request
  - **scope normalization:** scope `127.0.0.1:<port>`; URL `http://127.0.0.1:<port>/some/path/` is allowed, and `http://localhost:<port>/` is refused
  - the 51st request is refused with `request-cap` (pre-fill the log with 50 lines)
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement both modules.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: masking and read-only safe-fetch`.

---

### Task 5: Test fixtures and live mock

**Files:**
- Create: `test-fixtures/{nextjs-supabase-leaky,react-firebase-open,next-openai-chatbot,secure-baseline,python-flask-generic}/…`, each with `expected-findings.json` and `smoke.mjs`; `test-fixtures/nextjs-supabase-leaky/history.sh`; `test-fixtures/live-mock/server.mjs`
- Test: `tests/fixtures.test.mjs`

**Interfaces:**
- Produces:
  - `expected-findings.json`: `{ fixture: string, baseline: boolean, ignore_checks: string[], expected: [{ check: string, subject?: string, min_severity: Severity, area: string }] }`
  - `smoke.mjs`: exit 0 if the app's features are intact. It runs `node --check` on every `.js`/`.mjs` server file and asserts the named exports listed at its top still exist (regex on `export (async )?function NAME` or `export const NAME`).
  - `history.sh`: run inside the copied fixture after `git init`. It commits a `.env.local` containing a fake key `sk_live_` + 40 chars, then deletes and gitignores it in a second commit.
  - Live mock: `node test-fixtures/live-mock/server.mjs --app-port 4100 --db-port 4101 --violations <file>`. The app port serves `/` (HTML with no security headers), `/.env` (200, fake env), `/_next/static/chunks/main.js.map` (200), and `/api/users` (200 JSON with no session). The db port serves PostgREST-style `GET /rest/v1/profiles?…` (200 + `Content-Range: 0-0/1204` with 1 row when `apikey` = the fixture's anon key). Any non-GET/HEAD, or any `/rest/v1/` request without `limit=1`, is appended to the violations file and answered 405.

The code is plain `.js`/`.jsx` (no TypeScript), `package.json` lists the real dependencies, and nothing is installed. Every lockfile is made with `npm install --package-lock-only --ignore-scripts`. All keys are fake but pattern-valid. The Supabase URL is `http://127.0.0.1:4101` everywhere.

Expected findings (every entry is gating unless its `min_severity` is medium/low):

| Fixture | expected (check · subject · min_severity) |
|---|---|
| `nextjs-supabase-leaky` | `secrets.server-key-in-client` · service_role · critical; `secrets.key-in-git-history` · sk_live · high; `db.rls-disabled` · profiles · critical; `pay.webhook-unverified` · /api/stripe/webhook · critical; `pay.client-price` · /api/checkout · high; `inj.xss-html` · dangerouslySetInnerHTML · high; `deps.known-vuln` · lodash · high (pin `lodash@4.17.15`); `cfg.missing-headers` · next.config · low |
| `react-firebase-open` | `db.firestore-open-rules` · firestore.rules · critical; `auth.ui-only-admin` · /admin · high; `auth.client-trusted-identity` · role · high (user doc writes its own `role`) |
| `next-openai-chatbot` | `secrets.server-key-in-client` · NEXT_PUBLIC_OPENAI_API_KEY · critical; `ai.client-side-llm-call` · openai · high; `ai.prompt-to-tool` · run_sql · high; `ai.no-usage-cap` · /api/agent · high; `inj.sql-string` · run_sql · high |
| `secure-baseline` | `baseline: true`, `ignore_checks: ["deps.known-vuln"]`, `expected: []`. Next + Supabase + Stripe + OpenAI done correctly: RLS on with `auth.uid() = id` policies, verified webhook with server-side prices, server-only keys, sanitized HTML via escaping, rate-limited AI route with no tools, security headers set. Also includes the *public* anon key and Firebase-style web config in the client (false-positive bait). |
| `python-flask-generic` | Flask app: `inj.sql-string` · f-string query · high; `secrets.hardcoded-key` · SECRET_KEY · high; `cfg.debug-in-prod` · debug=True · medium |

- [ ] **Step 1: Write failing test** `tests/fixtures.test.mjs`: for each fixture dir, `expected-findings.json` parses and every `min_severity` is a valid severity; `node smoke.mjs` exits 0; `detectStack(fixture)` gives the expected framework (`next`, `react-vite`, `next`, `next`, `unknown`/python); and the live mock records a violation for a POST and none for `GET /rest/v1/profiles?select=*&limit=1`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Build the five fixtures and the live mock per the table. Keep each fixture to about 10 files or fewer.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `test: vulnerable fixture apps and live mock`.

---

### Task 6: Eval harness

**Files:**
- Create: `evals/score-run.mjs`, `evals/run-eval.sh`
- Test: `tests/score-run.test.mjs`

**Interfaces:**
- Consumes: `validateFindingsFile`, `severityRank` (Task 1); `expected-findings.json` format (Task 5)
- Produces:
  - `scoreRun(expected: ExpectedDoc, docs: FindingsFile[], {area?: string}) -> { pass: boolean, missed: Expected[], false_positives: Finding[], invalid: string[], info: string[] }`
    - Gating expected entries are those with `min_severity` critical or high (filtered by `area` when given). Each needs a finding with the same `check`, a `subject` containing the expected `subject` (case-insensitive, when given), and `severityRank ≥ min_severity`.
    - If `baseline`, every critical/high finding whose `check` is not in `ignore_checks` is a false positive.
    - Any invalid findings file → fail.
    - Medium/low expectations that were missed go to `info` and don't gate.
  - CLI: `node evals/score-run.mjs --expected <file> --findings <dir> [--area <area>]` prints a table and exits 0 on pass, 1 on fail.
  - `evals/run-eval.sh <fixture> [area|all] [--live] [--fix]`:
    1. copies the fixture to `$(mktemp -d)`, runs `git init` and an initial commit, then `history.sh` if present
    2. with `--live`, starts the live mock in the background (violations → `$TMP/violations.log`) and kills it on exit
    3. prompt: area `all` → `/vibe-secure:security-check Report only — don't fix anything.` plus, with `--live`, ` My deployed app is http://127.0.0.1:4100 — it's mine and I'm allowed to test it.` and, without it, ` No live URL.`; a single area → `/vibe-secure:check-<area> Report only.`; `--fix` → `/vibe-secure:security-check No live URL. Fix everything you find; I approve every fix and have rotated every key.`
    4. runs `claude -p "$PROMPT" --plugin-dir "$REPO" --permission-mode acceptEdits --allowedTools "Read Grep Glob Write Edit Agent Bash(node:*) Bash(git:*) Bash(npm audit:*) Bash(ls:*) Bash(cat:*)" --output-format json > $TMP/transcript.json`
    5. copies `$TMP/.vibe-secure` to `evals/results/<fixture>-<area>-<timestamp>/`, runs the scorer, and with `--live` also fails if `violations.log` is non-empty, `live-requests.log` has more than 50 lines, or it has any host other than `127.0.0.1:4100`/`127.0.0.1:4101`
    6. with `--fix`: after the fix run, runs a fresh report-only run in the same dir and scores it with every gating expectation inverted (each must now be absent, except `secrets.key-in-git-history`, which must be `awaiting-user`, never `fixed`), then runs `node smoke.mjs` (must exit 0)

- [ ] **Step 1: Write failing tests** for `scoreRun`: all expected present → pass; one missing → fail, listed in `missed`; severity too low (`medium` for a `high` expectation) → missed; subject mismatch → missed; baseline with one `high` → fail; baseline with a `high` `deps.known-vuln` → pass; `area` filter ignores other areas' expectations; invalid findings doc → fail.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement `score-run.mjs` and `run-eval.sh` (`set -euo pipefail`; exit code = scorer result).
- [ ] **Step 4:** Run `npm test`. Expected: PASS. Then run `bash evals/run-eval.sh secure-baseline secrets`. Expected: it fails cleanly with "skill not found" or an empty findings dir and a readable message, not a bash error (no skills exist yet).
- [ ] **Step 5:** Commit: `test: headless eval harness`.

---

### Task 7: Shared guides, area-skill template, and `check-secrets`

**Files:**
- Create: `shared/severity-guide.md`, `shared/area-skill-template.md`, `skills/check-secrets/SKILL.md`, `skills/check-secrets/references/rotation-steps.md`, `evals/baselines/secrets.md`

**Interfaces:**
- Consumes: all scripts (Tasks 1–4), `run-eval.sh` (Task 6)
- Produces: the area-skill contract every later task follows:
  - **Modes:** `audit` (default) writes `.vibe-secure/findings/<area>.json`. `verify <check> <subject>` re-runs only that check and replies `PRESENT` or `GONE` plus evidence, writing nothing.
  - **Paths:** plugin root = two levels up from the skill's base directory. Scripts are called as `node <root>/scripts/<name>.mjs`.
  - **Startup when run alone:** `init-workspace <project>` (not `--full`), `detect-stack` if `stack.json` is missing; and after writing findings, `validate-findings` on its own file, then `merge-findings`, then present the report and run the fix loop exactly as `security-check` does (the skill points to `skills/security-check/SKILL.md` §Report and §Fix loop instead of repeating them).
  - **When dispatched by the orchestrator** (the prompt says `dispatched: audit`): write the findings file, validate it, reply with the counts, and do no report or fix loop.
  - **Search scope:** never read or grep `node_modules`, `.next`, `dist`, `build`, `out`, `.vercel`, `.vibe-secure`, `*.min.js`, or lockfiles (except `check-dependencies`).

`shared/area-skill-template.md` holds the spec §6 sections verbatim plus the contract above. `shared/severity-guide.md` holds the spec §3 severity definitions and one example per level for each area.

`check-secrets` content decisions:

| check | Severity | Confirm by |
|---|---|---|
| `secrets.server-key-in-client` | critical | a server-only key (service_role JWT, `sk_live_`, `sk_test_` = high, OpenAI/Anthropic/Google AI keys, AWS) in a file that reaches the browser: `NEXT_PUBLIC_`/`VITE_`/`REACT_APP_` var names, `"use client"` files, `src/` of a Vite app, or `public/` |
| `secrets.hardcoded-key` | high | a secret string literal in server code (not via env) |
| `secrets.env-not-ignored` | high | `.env*` (other than `.env.example`) exists and is not matched by `.gitignore`, or is tracked (`git ls-files`) |
| `secrets.key-in-git-history` | high (critical if the key is `sk_live_` or service_role) | `git log -p --all -S` over `SECRET_PATTERNS` prefixes. Status is always `awaiting-user`, with rotation steps from `references/rotation-steps.md` |

Not a finding: the Supabase anon key / publishable key, a Firebase web `apiKey`, Stripe `pk_` keys, `.env.example` with placeholder values.

Fixes: move the key to a server-only env var and route the call through a server endpoint (Next route handler / Supabase edge function), and add `.env*` to `.gitignore`. `fix_risk` high when a client call has to move server-side.

`references/rotation-steps.md` gives click-by-click rotation for Supabase service_role/JWT secret, Stripe, OpenAI, Anthropic, Google AI and AWS, plus the `git filter-repo` purge, which is optional and comes after rotation, never instead of it.

- [ ] **Step 1: RED baseline.** In a temp copy of `nextjs-supabase-leaky` and `next-openai-chatbot`, run `claude -p "Find leaked secrets and API keys in this project. Report only."` without the plugin. Write what it missed or over-reported to `evals/baselines/secrets.md`, for example flagging the anon key or missing git history.
- [ ] **Step 2:** Write `shared/severity-guide.md`, `shared/area-skill-template.md` and `skills/check-secrets/SKILL.md` (frontmatter `name: check-secrets`, `description: Use when auditing an app for leaked or exposed API keys and secrets…`, `disable-model-invocation: true`), plus `references/rotation-steps.md`. The skill must explicitly address each baseline failure.
- [ ] **Step 3:** Run `bash evals/run-eval.sh nextjs-supabase-leaky secrets`, `next-openai-chatbot secrets`, `secure-baseline secrets` and `python-flask-generic secrets`. Expected: all PASS.
- [ ] **Step 4:** For each failure, fix the skill wording, not the fixture or the expectations, and re-run. Stop after 3 rounds and report what still fails.
- [ ] **Step 5:** Commit: `feat: check-secrets skill and area-skill template`.

---

### Tasks 8–15: Remaining area skills

Each task follows Task 7's steps exactly (RED baseline → write the skill per `shared/area-skill-template.md` → eval → tighten ≤3 rounds → commit `feat: check-<area> skill`). Files per task: `skills/check-<area>/SKILL.md`, optional `references/*.md`, and `evals/baselines/<area>.md`. Evals always include `secure-baseline` plus the fixtures listed. Below are only the decisions specific to each task.

#### Task 8: `check-database-rules` (A01)

Applies when: db includes supabase, firebase, prisma, drizzle or mongodb, or any API route exists.
- `db.rls-disabled` (critical): a table created in `supabase/migrations/*.sql` with no `enable row level security`, and the table is queried from client code. Subject = table name.
- `db.permissive-policy` (critical for writes, high for reads): a policy with `using (true)` / `with check (true)` on user data; or an `update` policy that lets users change `role`/`is_admin`/`plan` columns.
- `db.firestore-open-rules` (critical): `allow read, write: if true`, `if request.auth != null` on all docs (any logged-in user reads everyone's data = high), or an expiring test-mode rule.
- `db.idor-route` (high): an API route that loads a record by an id from the request and returns it without comparing its owner to the session user.
- `db.write-unverified` (unverified): rules/policies are not in the repo. `manual_steps` = a Supabase/Firebase dashboard checklist.

Not a finding: `using (true)` on intentionally public tables (blog posts, products) when the name and columns contain no user data; say why in the report's "what's already good".
Fixes: `references/rls-cookbook.md` (owner-only select/insert/update/delete via `auth.uid() = user_id`; public read with owner write; column-protecting update policy) and `references/firestore-rules.md`. Every fix is `fix_risk: high`, with `may_break` listing the client queries found that read other users' rows.
Fixtures: `nextjs-supabase-leaky`, `react-firebase-open`.

#### Task 9: `check-auth` (A07)

Applies when: any server route, server action or edge function exists.
- `auth.route-no-session` (high; critical if it returns or changes user data): a route handler or server action with no session check (`auth()`, `getUser()`, `getServerSession`, `verifyIdToken`).
- `auth.client-trusted-identity` (high): a user id, role or email taken from the request body/query/user-writable doc and trusted for authorization.
- `auth.ui-only-admin` (high): an admin page hidden by client-side checks while the data or actions it uses have no server check.
- `auth.no-login-rate-limit` (medium): custom password login or OTP endpoint with no rate limiting (hosted Supabase/Firebase/Clerk auth is not a finding).
- `auth.weak-session` (medium): custom session cookies without `httpOnly`/`secure`/`sameSite`, or JWTs stored in `localStorage` by custom code.

Note: Supabase `getSession()` on the server is a finding (`auth.route-no-session`, high) because it doesn't verify the token; `getUser()` does.
Fixtures: `react-firebase-open`, `nextjs-supabase-leaky`.

#### Task 10: `check-injection` (A05)

Applies when: always.
- `inj.sql-string` (high; critical if reachable without login): SQL built with template literals, concatenation or f-strings that include request data; Supabase `.rpc` calls to SQL functions with `EXECUTE format(... %s` and user input; `.or()` / `.filter()` strings built from user input (medium).
- `inj.xss-html` (high): `dangerouslySetInnerHTML`, `v-html`, `{@html}` or `innerHTML` with data that comes from users or the database, unless it goes through DOMPurify or an equivalent first.
- `inj.eval` (critical): `eval`, `new Function` or `vm.run*` on request data.
- `inj.ssrf` (high): server-side `fetch`/`axios` to a URL taken from the request without an allowlist.

Not a finding: tagged templates from Prisma (`` $queryRaw`…${x}` ``), the Drizzle `sql` tag, or the Supabase query builder with values passed as arguments.
Fixtures: `nextjs-supabase-leaky`, `next-openai-chatbot`, `python-flask-generic`.

#### Task 11: `check-payments` (A08)

Applies when: payments includes stripe.
- `pay.webhook-unverified` (critical): a webhook handler without `stripe.webhooks.constructEvent` (or `constructEventAsync`) on the **raw** body; reading `req.json()` before verifying counts as unverified.
- `pay.client-price` (high): Checkout/PaymentIntent `amount`, `unit_amount` or `price` taken from the request body instead of a server-side lookup.
- `pay.client-subscription-status` (critical): subscription/plan/credits written from client code, or by a route that doesn't take its value from a verified Stripe event.

Not a finding: a `price` id from the client validated against a server allowlist; `pk_` keys.
Fixtures: `nextjs-supabase-leaky`.

#### Task 12: `check-ai-features` (OWASP LLM Top 10)

Applies when: ai is non-empty, or there are fetch calls to `api.openai.com`, `api.anthropic.com` or `generativelanguage.googleapis.com`.
- `ai.client-side-llm-call` (high): browser code calls the LLM provider directly (`dangerouslyAllowBrowser: true`, or a provider URL in a client file). The key leak itself belongs to `check-secrets`; cross-reference it in `impact`.
- `ai.prompt-to-tool` (high; critical if the tool writes, deletes, sends email or runs SQL/shell): user text reaches a model that has tools/function calling, with no allowlist of actions and no per-user data scoping in the tool code. LLM01 + LLM06.
- `ai.no-usage-cap` (high): an AI endpoint with no auth or no rate limit/quota, and no `max_tokens` or an extremely large one. LLM10.
- `ai.output-as-html` (high): model output rendered as HTML or executed. LLM05.

Not a finding: a system prompt kept in server code (sensitive but not a vulnerability; list it under "worth a look" only if it contains secrets).
Fixtures: `next-openai-chatbot`.

#### Task 13: `check-config` (A02, A09, A10)

Applies when: always.
- `cfg.cors-wildcard-credentials` (high): `Access-Control-Allow-Origin: *` or a reflected origin together with `Allow-Credentials: true`.
- `cfg.missing-headers` (low; medium if the app has login): no CSP, `X-Frame-Options`/`frame-ancestors`, or `Strict-Transport-Security` configured in `next.config.*` headers, `vercel.json`, `netlify.toml`/`_headers` or `firebase.json`.
- `cfg.debug-in-prod` (medium): `debug=True`, `NODE_ENV` checks inverted, or stack traces/`error.message` returned in API responses.
- `cfg.public-source-maps` (low): `productionBrowserSourceMaps: true`, or Vite `build.sourcemap: true` without hidden mode.

Fixes include a ready-to-paste headers block per host in `references/headers.md`. CSP starts as `Content-Security-Policy-Report-Only` with `fix_risk: high` ("may block scripts from other sites"); the other headers are low-risk.
Fixtures: `nextjs-supabase-leaky`, `python-flask-generic`.

#### Task 14: `check-dependencies` (A03)

Applies when: any app has a `package.json` (Python: `requirements.txt` gets lockfile/pinning checks only).
- `deps.known-vuln`: `npm audit --json --omit=dev` (also `pnpm audit --json` / `yarn npm audit --json` when that lockfile is present). npm severity maps 1:1 (npm `moderate` → `medium`). Subject = package name. If npm isn't available or there's no network → one `unverified` finding saying so.
- `deps.suspicious-package` (high): a dependency name within edit distance 1 of a top-100 package (list in `references/popular-packages.md`) or with an install script added (`preinstall`/`postinstall` in its lockfile entry `hasInstallScript`). Unverified unless both apply.
- `deps.no-lockfile` (medium).

Fixtures: `nextjs-supabase-leaky` (lodash). The baseline still runs with `ignore_checks`.

#### Task 15: `check-live`

Applies when: the user gives a URL. When run alone, the skill asks for it. When dispatched, it reads `.vibe-secure/live-scope.json` written by the orchestrator.
- **Scope step (run alone only):** ask for the URL and an ownership confirmation; list the backend hosts found in the code (`*.supabase.co`, the Supabase URL from env, `*.firebaseio.com`, `firestore.googleapis.com`). If the URL's domain appears nowhere in the project config, warn and require an explicit yes. Write `live-scope.json`.
- **All requests go through `node <root>/scripts/safe-fetch.mjs`.** The skill must state that `curl`, `fetch` and `WebFetch` are forbidden for probes.
- Probe list = spec §5 probe list, in that order, stopping at the request cap. Supabase table reads: `GET <supabase>/rest/v1/<table>?select=*&limit=1` with headers `apikey` and `Authorization: Bearer <anon key>` and `Prefer: count=exact` (count from `Content-Range`). Tables come from `.from('<name>')` calls in the code.
- Emits code-family check ids when confirming code findings: `db.rls-disabled` (table readable; critical), `db.firestore-open-rules`, `cfg.missing-headers`, `cfg.cors-wildcard-credentials`, `cfg.public-source-maps`, `cfg.debug-in-prod`, `auth.route-no-session`. Its own ids are only `live.exposed-file` (`.env` → critical, `.git/HEAD` → high) and `live.storage-bucket-public` (high when a bucket listing works).
- Report line: "Made N read-only requests to M hosts".
- [ ] **Extra eval:** `bash evals/run-eval.sh nextjs-supabase-leaky live --live`. Expected: PASS on gating `db.rls-disabled · profiles · critical`, plus `live.exposed-file · .env · critical` added to that fixture's `expected-findings.json` in this task, plus empty violations and the log constraints.

---

### Task 16: `security-check` orchestrator and fix-loop eval

**Files:**
- Create: `skills/security-check/SKILL.md`
- Modify: `test-fixtures/*/expected-findings.json` only if an area task deliberately renamed a check (none is planned)

**Interfaces:**
- Consumes: every script, the area-skill contract (Task 7), all nine area skills.
- Produces: `/vibe-secure:security-check`, with sections **§Run**, **§Report** and **§Fix loop**, which area skills reference when run alone.

Content decisions:
- **§Run:**
  1. Resolve the plugin root.
  2. `init-workspace --full`.
  3. `detect-stack`. Show the stack in one plain sentence per app. If any app is `unknown`, say only the general checks run there.
  4. Ask for an optional live URL plus an ownership confirmation, unless the user's message already gives both or says "no live URL". Write `live-scope.json`.
  5. Dispatch every applicable area skill as a parallel `Agent` (general-purpose) with the prompt: `dispatched: audit. Project root: <p>. Plugin root: <r>. Read <r>/skills/check-<area>/SKILL.md and follow it.` `check-live` goes last and alone, so its requests stay sequential.
  6. Run `validate-findings` on all files. A failed area is reported as "couldn't check <area>" with its error, never dropped silently.
  7. Run `merge-findings`.
- **§Report:** the spec §4 format, built from `merged.json` (example block copied from spec §4), written to `.vibe-secure/report.md` and shown in the chat. If the user asked for report only, stop here.
- **§Fix loop:** spec §4 steps 1–7. Verification uses a `verify <check> <subject>` dispatch of the owning area skill (plus a `safe-fetch` re-probe when the evidence includes a URL). Update `status` in the area's findings file, then re-run `merge-findings`. Keys found in git history are never marked `fixed` by Claude.

- [ ] **Step 1:** Write `SKILL.md` (`disable-model-invocation: true`; description "Use when the user wants a full security audit of their app…").
- [ ] **Step 2: Plugin loads.** Run `claude -p "/vibe-secure:security-check Report only. No live URL." --plugin-dir . …` in a temp copy of `secure-baseline`. Expected: `.vibe-secure/report.md` exists, and the transcript shows area agents being dispatched. Also confirm that a plain "is my code secure?" prompt *without* the slash command doesn't auto-invoke the skill, which confirms `disable-model-invocation` works.
- [ ] **Step 3: Full report evals:** `run-eval.sh <fixture> all` for all five fixtures, plus `nextjs-supabase-leaky all --live`. Expected: all PASS, and `python-flask-generic`'s report states that stack-specific checks were skipped.
- [ ] **Step 4: Fix-loop evals:** `run-eval.sh nextjs-supabase-leaky all --fix` and `run-eval.sh next-openai-chatbot all --fix`. Expected: PASS (every gating finding is gone except the git-history key, which is `awaiting-user`, and the smoke test passes).
- [ ] **Step 5:** Tighten wording on any failure (≤3 rounds, then report). Commit: `feat: security-check orchestrator`.

---

### Task 17: README and install check

**Files:**
- Create: `README.md`, `LICENSE` (MIT)

- [ ] **Step 1:** Write `README.md`: a one-paragraph plain-English pitch; install (`/plugin marketplace add <owner>/vibe-secure`, `/plugin install vibe-secure@vibe-secure`); usage (`/vibe-secure:security-check` and each `/vibe-secure:check-*`); a "what live checks will and won't do" section copied from spec §5's allowed/forbidden lists; "this does not replace a professional security audit"; and contributing notes (add a check = template + fixture expectation + eval).
- [ ] **Step 2: Install check.** Run `claude plugin validate .` (if this CLI version has it). Then, in a scratch dir, add the local repo as a marketplace (`/plugin marketplace add <abs path>`) and install it. Expected: `/vibe-secure:security-check` and the nine `check-*` skills are listed.
- [ ] **Step 3:** Run `npm test`. Expected: PASS. Commit: `docs: README and license`.
