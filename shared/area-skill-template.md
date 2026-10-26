# Area skill template

Every `skills/check-<area>/SKILL.md` follows this template. It has two parts: the sections from the design spec (§6), and the run contract that makes area skills work alone, under the orchestrator, and in the scorer. `skills/check-secrets/SKILL.md` is the reference implementation, so copy its shape.

## Part 1: Sections (design spec §6, verbatim)

Every `check-*` skill's `SKILL.md` has these sections:

1. **Frontmatter:** `name`, and a `description` starting "Use when auditing…".
2. **What this protects against:** 2–3 plain sentences plus the OWASP reference.
3. **Applies when:** the `stack.json` conditions.
4. **Checks:** a numbered list. For each: what to look for (files, patterns), how to confirm it's real, the severity rule, and per-stack notes.
5. **Fixes:** the safe pattern per stack with code, plus what might break.
6. **Not a finding:** known false positives. For example, the Supabase anon key and Firebase web config are meant to be public; only `service_role` or admin keys are leaks.

Long per-stack material lives in `references/` and is loaded only when that stack is detected.

### Additions this project requires

- Frontmatter also sets `disable-model-invocation: true`. Skills run only when the user types the slash command or the orchestrator dispatches them.
- Each check in **Checks** starts with its stable check id in backticks (`secrets.hardcoded-key`) and states its **subject** (see "Subject conventions" below), its severity rule, its `owasp` value and its `fix_risk` level.
- A **How to run** section, copied from Part 2 below with `<area>` filled in.
- A **Findings file** section with an example finding for this area.

## Part 2: Run contract

### Names

- `area` = the skill name without `check-`: `secrets`, `database-rules`, `auth`, `injection`, `payments`, `ai-features`, `config`, `dependencies`, `live`.
- Findings file: `.vibe-secure/findings/<area>.json`. `area: "<area>"` goes on the file and on every finding.
- Finding ids: `<area>-<n>`, numbered from 1 in each audit run (`secrets-1`, `secrets-2`).
- Check ids: `<prefix>.<kebab-name>`, with the prefix fixed per area: `secrets`, `db`, `auth`, `inj`, `pay`, `ai`, `cfg`, `deps`, `live`. Never invent a check id that isn't listed in the skill.

### Paths

- **Plugin root (`<root>`):** when the skill loads, its base directory is shown ("Base directory for this skill: …/skills/check-<area>"). The plugin root is two levels up from it. When dispatched, the prompt gives it as `Plugin root: <r>`.
- **Project root:** the current working directory, unless a dispatch prompt gives `Project root: <p>`. In that case, substitute that path for `.` in every command template (`node <root>/scripts/init-workspace.mjs <p>`, `git -C <p> …`), and resolve relative paths against it.
- Scripts are always called as `node <root>/scripts/<name>.mjs …`, with the absolute plugin root.

### Modes

| Mode | How it's invoked | What it does |
|---|---|---|
| `audit` (default) | `/vibe-secure:check-<area>` with no mode word, or a dispatch saying `dispatched: audit` | Runs every check and writes `.vibe-secure/findings/<area>.json` |
| `verify <check> <subject>` | the user types it after the slash command, or a dispatch says `dispatched: verify <check> <subject>` | Re-runs only that check, only for that subject. Replies `PRESENT` or `GONE` on the first line, then the evidence (`file:line`, masked). Writes nothing: no findings file, no `rotations.json`, no report |

### Startup in verify mode

Verify needs only `<root>`, the project root, and whatever tools the check itself uses (for example git). Don't run `init-workspace` or `detect-stack`, because both write files. Read `.vibe-secure/stack.json` if it exists; if it doesn't, read the app's `package.json` (or Python manifest) directly to learn the stack.

### Startup when run alone (audit mode)

1. Resolve `<root>`.
2. `node <root>/scripts/init-workspace.mjs .` (never `--full` from an area skill: that would delete other areas' results).
3. If `.vibe-secure/stack.json` doesn't exist, run `node <root>/scripts/detect-stack.mjs .`. Read `stack.json`. If an app's framework is `unknown`, run the general checks there and say in the report that stack-specific checks were skipped for it.
4. Read `.vibe-secure/rotations.json` if the skill has rotation findings (see "Rotations").
5. Run the checks for every app in `stack.json` that the skill applies to (and the repo-wide checks once), then apply the rotation rules.
6. Write the findings file (see "Findings file rules") and, if the skill uses it, `rotations.json`.
7. `node <root>/scripts/validate-findings.mjs .vibe-secure/findings/<area>.json`. If it fails, fix the file and re-run until it passes.
8. Follow `<root>/shared/report-and-fix.md`: merge, report (this area only), then the fix loop. A report-only request skips only the fix loop: you still run `merge-findings`, show the report and save it to `.vibe-secure/report-<area>.md` before stopping.

### When dispatched by the orchestrator

The prompt says `dispatched: audit` (or `dispatched: verify …`) and gives the project and plugin roots. The orchestrator has already run `init-workspace` and `detect-stack`.

- **`dispatched: audit`:** run the checks (and the rotation rules), write and validate the findings file (and write `rotations.json`), then reply with: the counts per severity, the "already good" lines, and any check you skipped and why. Don't show a report, don't run `merge-findings`, and don't start the fix loop.
- **`dispatched: verify <check> <subject>`:** as `verify` above.

### Search scope

Never read or search inside `node_modules`, `.next`, `dist`, `build`, `out`, `.vercel`, `.vibe-secure`, `.git` (use `git` commands for history), `*.min.js`, or lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`, `poetry.lock`, `Pipfile.lock`). The one exception is `check-dependencies`, which reads lockfiles. If a search tool returns hits from these paths, discard them. They are vendor or build output, not the user's code, and reporting them floods the user with false alarms.

Search tools can skip hidden or gitignored files (such as `.env.local`). When a check needs those files, list them with `ls -a` and read them directly.

### Commands

Run one plain command per Bash call. `&&`, `;`, `||`, `$?`, `$(…)`, `{…}` (including regex quantifiers such as `{16,}`, even inside quotes) and pipes into other programs make Claude Code ask for approval, and headless runs refuse them. Write any regex a skill gives without braces. Use the Read, Grep and Glob tools for files. Don't write helper scripts or scratch files, in the project or anywhere else. The only files an area skill writes are its findings file, `rotations.json` (if it owns rotation findings) and, when run alone, its report.

### Findings file rules

- **Always write the file in audit mode**, even when nothing is wrong. A clean run writes `"findings": []`. The file is the proof the audit ran.
- Each audit overwrites the whole file. Don't append to an older run.
- Shape: `{ "area": "<area>", "generated_at": "<ISO time>", "mode": "audit", "findings": [ … ] }`. Get `generated_at` (and every other time stamp) from `node -e "console.log(new Date().toISOString())"`; never guess it. All four top-level fields are required, and the skill must show this skeleton in its own "Findings file" section. Every finding has every field from `<root>/shared/finding-format.md`.
- **No proof, no finding.** Every finding has at least one evidence item (`{ "file": "<path from project root>", "line": <n> }`). A suspicion you can't prove is `severity: "unverified"`; it may have empty evidence and appears only under "worth a look".
- **Secrets are always masked**, everywhere: `subject`, `title`, `impact`, `fix_plan`, `manual_steps`, evidence summaries, and your chat replies. Mask with `node -e "import('<root>/scripts/mask.mjs').then(m=>process.argv.slice(1).forEach(k=>console.log(m.maskSecret(k))))" '<value>'`. `validate-findings` rejects files with unmasked keys of the formats it knows, but you must mask every other secret yourself (passwords, tokens, connection strings).
- `title` is the consequence in plain English and the second person ("Anyone can …", "Your …"). The OWASP id goes only in `owasp` (e.g. `A04:2025 Cryptographic Failures`).
- Severity uses `<root>/shared/severity-guide.md` and the check's own rule.
- `fix_risk.level` is `high` whenever the fix changes who can access what or moves code between browser and server. `may_break` names what the user would notice.
- `status` is `open`, except where a check says `awaiting-user` (things only the user can do, such as rotating a leaked key) or the rotation rules say `fixed`.
- Secrets used only by tests or fixtures (test folders, `*.test.*`/`*.spec.*`, `conftest.py`, jest/vitest setup files) are not findings, unless app code imports them.
- **Stay in your area.** If you notice a problem that belongs to another area (for example SQL injection while checking secrets), don't write a finding for it. Mention it in one line of your reply and name the skill that covers it.

### Rotations (`.vibe-secure/rotations.json`)

Some findings can only be fixed by the user, outside the code: above all, rotating a leaked key. Deleting the key from the code doesn't un-leak it, and `init-workspace --full` deletes every findings file. So these to-dos live in one persistent file that `init-workspace` never deletes:

```json
{ "rotations": [
  { "check": "secrets.key-in-git-history", "fingerprint": "48e65b779a33", "subject": "sk_live_4f…a9", "severity": "critical",
    "evidence": [{ "file": "config/payments.env", "line": 2, "commit": "abc1234" }],
    "status": "awaiting-user", "first_seen": "2025-03-14T10:02:11.000Z" },
  { "check": "secrets.leaked-key-unrotated", "fingerprint": "9f2c41d07be3", "subject": "eyJhb…Qk", "severity": "critical",
    "evidence": [{ "file": "src/lib/db.ts", "line": 4 }],
    "status": "confirmed", "first_seen": "2025-03-14T10:02:11.000Z", "confirmed_at": "2025-03-15T08:30:00.000Z" }
] }
```

`check` + `fingerprint` identify an entry. `fingerprint` is the first 12 hex characters of the SHA-256 of the raw key, computed in memory with `node -e` (see the skill's masking command) and never written raw. `subject` is the masked key, for display only: two different keys can mask the same way, so never match on it. `evidence` is stored as first found. A skill that owns rotation findings (today: `check-secrets`) follows these rules:

1. **Audit, read:** read the file if it exists. A missing file means no entries. Only touch entries whose `check` belongs to your area.
2. **Audit, raise:** when you raise a finding that needs a rotation, compute the key's fingerprint and look up the entry with the same `check` + `fingerprint`. `confirmed` → the finding's status is `fixed` (it stays listed, under "already fixed"). `awaiting-user` or no entry → status `awaiting-user`; add the entry if it's missing (`status: "awaiting-user"`, `first_seen` = now).
3. **Audit, re-raise:** an `awaiting-user` entry whose fingerprint matches no key found in this run (because the code evidence is gone) is raised again as a finding built from the entry: same check, subject, severity and stored evidence, `status: "awaiting-user"`, and an `impact` saying it was found by an earlier check and still needs rotating.
4. **Audit, write:** write the file back. Entries are added or updated, never removed.
5. **Confirm (fix loop only):** when the user says they rotated a specific key (or "all of them"), set that entry's `status` to `confirmed` and `confirmed_at` to now, and set the finding with the same `check` + `subject` as the entry to `fixed`. Nothing else confirms a rotation: not approving fixes, not a code change, not a history purge.
6. **Code fixed, key not rotated (fix loop):** when a finding whose key has an `awaiting-user` entry turns `fixed` because its code evidence is gone (for example a browser leak moved to the server), add a finding built from the entry to the area's findings file right away (the entry's check, subject, severity and evidence, `status: "awaiting-user"`), re-validate and re-merge. The reminder then shows in this session's report and to-do list, not only at the next audit.
7. **Verify mode** never reads or writes this file.

### Subject conventions

The `subject` names the thing affected. Merge removes duplicates by `check` + `subject`, and the eval scorer matches expected findings by a case-insensitive substring of `subject`, so subjects must be predictable. Use the bare name. Don't add descriptions such as "in lib/x.js", and keep paths in `evidence`.

| Finding kind | Subject | Example |
|---|---|---|
| A key or secret in the current code or env files | the env var or identifier name that holds it | `VITE_MAILGUN_API_KEY`, `JWT_SECRET` |
| A key found in git history, or a leaked key still waiting for rotation | the masked key | `sk_live_4f…a9` |
| An env or secrets file problem | the file name, with its path from the project root if not at the root | `.env.production`, `apps/web/.env.local` |
| `inj.xss-html` | the sink name, or the raw-HTML markdown renderer setting | `dangerouslySetInnerHTML`, `v-html`, `innerHTML`, `rehype-raw` |
| Other injection in a function or tool | the function or tool name | `find_user`, `query_db` |
| `ai.client-side-llm-call` | the provider name | `openai`, `anthropic`, `google` |
| A route or page | the route path as users call it, with dynamic segments as `:name` | `/api/orders`, `/api/billing/webhook`, `/orders/:id` |
| A server action | `action:<function name>` | `action:deleteNote` |
| A Supabase Edge Function | `/functions/v1/<name>` | `/functions/v1/send-invoice` |
| A Firebase or other cloud function | `fn:<exported name>` | `fn:createInvoice` |
| A database function called through `/rpc` or `.rpc()` | `rpc:<function>` | `rpc:get_report` |
| A Storage bucket | `storage:<bucket>` | `storage:uploads` |
| An app-hosted MCP server | `mcp:<server>` (or the tool name) | `mcp:notes` |
| A Stripe customer id taken from the request | `customerId` | `customerId` |
| A database table or collection | the table or collection name | `orders` |
| A rules or config file | the file name | `firestore.rules`, `vite.config` |
| A dependency | the package name | `minimist` |
| A setting or field | the setting or field name | `DEBUG = True`, `is_admin` |

Each area skill restates the subject for each of its checks, using these conventions.

### Template for the "How to run" section

Copy this into each `SKILL.md`, replacing `<area>`:

```markdown
## How to run

Follow the run contract in `<root>/shared/area-skill-template.md` (Part 2). In short:

- `<root>` = two levels up from this skill's base directory (or `Plugin root:` in a dispatch prompt). Project root = the current directory (or `Project root:`).
- **Mode:** `audit` unless the request says `verify <check> <subject>`.
- **Time stamps:** `node -e "console.log(new Date().toISOString())"`. Never guess.
- **Alone, audit:** `node <root>/scripts/init-workspace.mjs .`, then `node <root>/scripts/detect-stack.mjs .` if `.vibe-secure/stack.json` is missing → run the checks → write `.vibe-secure/findings/<area>.json` (always, `"findings": []` when clean) → `node <root>/scripts/validate-findings.mjs .vibe-secure/findings/<area>.json` until it passes → follow `<root>/shared/report-and-fix.md` (if the user asked for a report only, still run `merge-findings`, show the report and save it to `.vibe-secure/report-<area>.md`; then stop).
- **`dispatched: audit`:** run the checks, write and validate the file, reply with counts, "already good" lines and skipped checks. No report, no fix loop.
- **`verify <check> <subject>`:** no init or detect-stack (read `stack.json` or `package.json` directly); re-run that one check for that subject, reply `PRESENT` or `GONE` plus masked evidence, write nothing.
- **Dispatched project root:** substitute it for `.` in every command.
- **Search scope:** never look inside `node_modules`, `.next`, `dist`, `build`, `out`, `.vercel`, `.vibe-secure`, `*.min.js` or lockfiles.
- **Commands:** one plain command per Bash call: no `&&`, `;`, `||`, `$?`, `$(…)`, `{…}` or pipes into other programs, because those need extra approval and may be refused. Use the Read and Grep tools for files. Don't write helper scripts or scratch files, in the project or anywhere else.
```
