---
name: check-secrets
description: Use when auditing an app for leaked or exposed API keys and secrets, such as server keys shipped to the browser, secrets hard-coded in the code, .env files that aren't gitignored, and keys still in git history.
disable-model-invocation: true
---

# Check secrets

## What this protects against

API keys and secrets are passwords your app uses to talk to other services. If a server-only key ends up in the browser, in a file you commit, or in your git history, a stranger can use it as you: read or wipe your database, issue refunds, or run up your AI bill. Deleting the key from the code later doesn't help, because copies already exist, so the only real fix for a leaked key is to rotate it (replace it with a new one).

OWASP: `A04:2025 Cryptographic Failures` (secrets management) for key leaks, and `A02:2025 Security Misconfiguration` for `.env` files that aren't ignored.

## Applies when

Always: every app in `stack.json`, including `unknown` and Python apps. These are general checks. The git-history check runs once per repository. If the project isn't a git repository (`git rev-parse --is-inside-work-tree` fails), skip the git parts of checks 3 and 4 and say so in the report.

## How to run

Follow the run contract in `<root>/shared/area-skill-template.md` (Part 2). In short:

- `<root>` = two levels up from this skill's base directory (or `Plugin root:` in a dispatch prompt). Project root = the current directory, or the `Project root:` from a dispatch prompt. In that case, use that path wherever a command below says `.`.
- **Mode:** `audit` unless the request says `verify <check> <subject>`.
- **Alone, audit:** `node <root>/scripts/init-workspace.mjs .`, then `node <root>/scripts/detect-stack.mjs .` if `.vibe-secure/stack.json` is missing → read `.vibe-secure/rotations.json` if it exists → run the checks → apply the rotation rules (below) → write `.vibe-secure/findings/secrets.json` (always, `"findings": []` when clean) and `.vibe-secure/rotations.json` → `node <root>/scripts/validate-findings.mjs .vibe-secure/findings/secrets.json` until it passes → follow `<root>/shared/report-and-fix.md` (stop after the report if the user asked for a report only).
- **`dispatched: audit`:** run the checks and the rotation rules, write and validate the files, reply with counts, "already good" lines and skipped checks. No report, no fix loop.
- **`verify <check> <subject>`:** needs only `<root>`, the project root and git. Don't run `init-workspace` or `detect-stack`. If `stack.json` is missing, read `package.json` directly. Re-run that one check for that subject, reply `PRESENT` or `GONE` plus masked evidence, write nothing.
- **Time stamps:** get the current time with `node -e "console.log(new Date().toISOString())"`. Never guess it.
- **Search scope:** never look inside `node_modules`, `.next`, `dist`, `build`, `out`, `.vercel`, `.vibe-secure`, `*.min.js` or lockfiles.
- **Commands:** one plain command per Bash call: no `&&`, `;`, `||`, `$?`, `$(…)`, `{…}` or pipes into other programs, because those need extra approval and may be refused. Use the Read and Grep tools for files. Don't write helper scripts or scratch files, in the project or anywhere else.

Stay in this area. If you notice other problems (database rules, injection, webhooks), mention them in one line of your reply and name the skill that covers them, but don't write findings for them.

## Know your keys

Every check depends on telling secret keys from public ones. Classify each value you find with this list before deciding anything.

**Secret (server-only). A leak is a finding:**

| Provider | What it looks like |
|---|---|
| Supabase service role | a JWT (`eyJ….eyJ….…`) whose middle part decodes to `"role":"service_role"`; or a `sb_secret_…` key; or the project's JWT secret (`SUPABASE_JWT_SECRET`) |
| Stripe | `sk_live_…`, `rk_live_…` (restricted), `sk_test_…`, `rk_test_…`, webhook secret `whsec_…` |
| OpenAI | `sk-proj-…`, `sk-svcacct-…`, `sk-…` |
| Anthropic | `sk-ant-…` |
| Google AI (Gemini) | an `AIza…` key that a Gemini SDK or endpoint reads: `@google/generative-ai`, `@google/genai`, `google-generativeai`, `generativelanguage.googleapis.com`, or a variable named like `GEMINI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`. A key only named `GOOGLE_API_KEY` is `unverified` unless you can show a Gemini SDK or endpoint reading it, because Maps and other browser keys use that name too |
| AWS | access key id `AKIA…` / `ASIA…` with its secret access key (`AWS_SECRET_ACCESS_KEY`) |
| Private keys | `-----BEGIN … PRIVATE KEY-----` blocks (in `.pem`/`.key` files or inside JSON), and Google/Firebase service-account files (`"type": "service_account"` with a `private_key`) |
| Anything else | values of variables or fields named with `SECRET`, `PRIVATE_KEY`, `PASSWORD`, `SERVICE_ROLE`, `TOKEN`, `AUTH_SECRET`/`NEXTAUTH_SECRET`/`JWT_SECRET`/`SECRET_KEY` (session-signing secrets), server API keys (`re_…` Resend, `SG.…` SendGrid, `ghp_…`/`github_pat_…`, `xox…` Slack, Twilio auth tokens), and database URLs with a password (`postgres://user:password@host`) |

To read a JWT's role without printing the key: `node -e "console.log(JSON.parse(Buffer.from(process.argv[1].split('.')[1],'base64url')).role)" '<jwt>'`.

**Public by design. Never a finding on its own:**

- Supabase **anon** key (a JWT whose role is `anon`), `sb_publishable_…`, and the Supabase project URL. Row level security protects the data, not this key.
- Firebase web config: `apiKey: "AIza…"` next to `authDomain`, `projectId` or `appId`, or a variable named like `FIREBASE_API_KEY`. Firebase security rules protect the data.
- Stripe publishable keys `pk_live_…` / `pk_test_…`.
- Other keys made for browsers: Clerk `pk_…`, Mapbox `pk.…`, Sentry DSNs, PostHog `phc_…`, Algolia search-only keys, reCAPTCHA site keys, Google Maps JavaScript keys.

**Placeholders. Skip them:** empty values, and values such as `your-key-here`, `xxx…`, `<…>`, `changeme`, `sk-...`, `replace-me`.

**Never decide a key is fake from its text.** A pattern-valid key containing `FAKE`, `test`, `dummy` or `example` is still treated as real: you can't check it, and a hedge like "probably a placeholder" makes users skip rotation. Only the placeholders listed above are skipped. The one exception is where the key lives (see "Not a finding": test-only files).

**Can't tell?** An `AIza…` key that might be Firebase, Maps or Gemini, or an unknown token with no telling name: write it as `severity: "unverified"` under the check that fits, with one sentence on what the user should check. Never guess `critical`.

**Masking and fingerprints:** mask every value before it goes into any field or reply. This command prints the masked value and its fingerprint (the first 12 hex characters of its SHA-256) for each value:
`node -e "import('<root>/scripts/mask.mjs').then(m=>process.argv.slice(1).forEach(k=>console.log(m.maskSecret(k), require('crypto').createHash('sha256').update(k).digest('hex').slice(0,12))))" '<value>'`
The masked value (`sk_live_4f…a9`) is for display. The fingerprint is how `rotations.json` recognises the same key across audits, because different keys can mask alike. Never write a raw value anywhere. For a private key, use the first line of the key body (the line after `BEGIN`), or the `private_key_id` of a service-account file, as the value to mask and fingerprint.

## Checks

### 1. `secrets.server-key-in-client`: a secret key reaches the browser

**Subject:** the env var name (for example `VITE_MAILGUN_API_KEY`). For a literal written in browser code, the variable or property that holds it (`apiKey`, `OPENAI_KEY`).
**OWASP:** `A04:2025 Cryptographic Failures`. **fix_risk:** `high` when a browser call has to move to the server, which is the usual case; `low` when only a variable needs renaming or a config line removing because every use is already server-side.
**`impact`** names the masked key, so the rotation rules can match it.

**Code that reaches the browser:**

- Environment variables with a public prefix are copied into the browser bundle at build time: `NEXT_PUBLIC_` (Next.js), `VITE_` (Vite), `REACT_APP_` (Create React App), `EXPO_PUBLIC_`, `PUBLIC_` (SvelteKit `$env/static/public`, Astro), `NUXT_PUBLIC_`, `GATSBY_`.
- **Build config that exposes variables without a prefix.** Any server-only variable it names counts as reaching the browser, with the config line as evidence:
  - `next.config.*` with an `env: { … }` block (Next inlines every variable listed there into browser code);
  - Vite `define` that injects env values (`define: { 'process.env': process.env }` exposes **all** of them; `'process.env.X': JSON.stringify(process.env.X)` exposes `X`), and `envPrefix` set to `''` or to a prefix that server secrets also use (`envPrefix: ['VITE_', 'STRIPE_']`);
  - webpack `DefinePlugin` (or `EnvironmentPlugin`) given server variables or the whole `process.env`;
  - Expo `app.config.*` / `app.json` `extra` values. They ship inside the app and are readable through `Constants.expoConfig.extra`.
- **Next.js:** files that start with `'use client'` and every file they import (follow the imports: a `lib/` file imported by a client component ships too); `pages/**` page components (but not `pages/api/**`, and not code inside `getServerSideProps`/`getStaticProps`). App-router server components, `route.js`/`route.ts` handlers, `'use server'` actions, `middleware` and files that `import 'server-only'` stay on the server.
- **Vite, Create React App and other single-page React apps (`react-vite`):** everything under `src/`, plus `index.html`. There is no server code unless there's a separate `api/`, `functions/` or `supabase/functions/` folder.
- **SvelteKit:** everything except `+page.server.*`, `+layout.server.*`, `+server.*`, `hooks.server.*` and `src/lib/server/**`. **Remix:** route components and any file not named `*.server.*`. `loader` and `action` run on the server.
- **Any stack:** `public/` and `static/` folders, Python `templates/`, and any plain `.html`/`.js` file served as-is.

**Find it:**

1. List the env files of every app with `ls -a <app dir>` (search tools may skip hidden or gitignored files): `.env`, `.env.local`, `.env.development`, `.env.production` and the like. Read them all, including gitignored ones, because the build reads them. Also read env sections in `vercel.json`, `netlify.toml` and `app.json`/`app.config.*`.
2. Read the build config of every app (`next.config.*`, `vite.config.*`, `webpack.config.*`, `app.config.*`/`app.json`) for the exposure paths above.
3. For every variable that reaches the browser (public prefix or exposed by config), classify its value with "Know your keys". A secret value is a hit. A blank or placeholder value is still a hit when the **name** clearly means a server secret (`…SERVICE_ROLE…`, `…SECRET…`, `…OPENAI_API_KEY`, `…ANTHROPIC…`) **and** browser code reads it (or config exposes it), because the real value is set on the host and ships at build time.
4. Search browser files for secret literals (the formats above) and for reads of server-only variables (`process.env.X`, `import.meta.env.X`).

**Confirm:** you can point at the env file line holding the value (or the literal), **and** at the `file:line` where browser code uses it or build config exposes it, or the prefix itself puts it in the bundle (Vite, CRA and Expo inline every prefixed variable that code reads). Put both in `evidence`.

**Severity:** `critical`. A Stripe `sk_test_`/`rk_test_` key → `high`. In Next.js, when every read of the `NEXT_PUBLIC_` secret is in server-only code (Next only inlines the variable into browser code that reads it) → `high`, and say in `impact` that one import from a client file would leak it.

**Status:** `open`. Add the provider's rotation steps (from `references/rotation-steps.md`) to `manual_steps`, because a key that was ever deployed in the bundle is already public. The rotation itself is tracked by the rotation rules (check 5). When the code fix verifies `GONE`, this finding becomes `fixed`, and in the same step the fix loop adds the `secrets.leaked-key-unrotated` reminder built from the key's rotation entry (rotation rule 6), so the reminder stays in this session's report and to-do list.

### 2. `secrets.hardcoded-key`: a secret is written into the code

**Subject:** the variable, config key or field name that holds it (`JWT_SECRET`, `STRIPE_KEY`, `apiKey`); for a key file, its file name (`deploy-key.pem`, `firebase-service-account.json`).
**OWASP:** `A04:2025 Cryptographic Failures`. **fix_risk:** `low`, but a session-signing secret signs everyone out when it changes, so say so in `may_break`.

**Find it:** in server and shared code (anything not covered by check 1), look for:

- string literals in the secret formats above;
- string literals assigned to secret-named variables, fields or config keys (`…SECRET…` or `…_KEY` settings in a Django `settings.py` or a Flask `app.config[…]`, `password: "…"`, `client_secret`, `Authorization: "Bearer …"`, `new Stripe("sk_…")`, `new OpenAI({ apiKey: "sk-…" })`);
- `-----BEGIN … PRIVATE KEY-----` blocks in any file;
- tracked service-account files: `git ls-files '*service*account*.json' '*service-account*.json' '*firebase-adminsdk*.json'`, then read each one to confirm it holds `"type": "service_account"` and a `private_key`;
- database URLs with a real password in code or config files;
- real (non-placeholder) secret values in templates meant to be committed: `.env.example`, `.env.sample`, `.env.template`.

**Confirm:** the value is a literal, not read from the environment (`process.env`, `import.meta.env`, `os.environ`, `os.getenv`, a secrets manager); it isn't a placeholder; it isn't a public key; and the file isn't test-only (see "Not a finding"). A literal in a browser file is check 1, not this one. Never report the same value twice.

**Severity:** `high`. A literal used only as a fallback (`process.env.X ?? "dev-secret"`, `os.getenv("X", "dev")`) → `medium`, and say in `impact` that the fallback is used whenever the variable isn't set.

**Status:** `open`. If the file is tracked by git, the old value has leaked: add to `manual_steps` "Change this secret's value (the old one is in your git history)", plus the provider's rotation steps when there is a provider. Name the masked value in `impact`.

### 3. `secrets.env-not-ignored`: an env file can be committed

**Subject:** the env file name, with its path from the project root if it isn't at the root (`.env`, `apps/web/.env.local`).
**OWASP:** `A02:2025 Security Misconfiguration`. **fix_risk:** `low`.

**Find it:**

1. Tracked env files anywhere in the repository: `git ls-files '*.env' '*.env.*' '**/.env*'`.
2. Untracked env files at the project root and in every app folder: `ls -a <dir>`.

Leave out committed-by-design templates (`.env.example`, `.env.sample`, `.env.template`, `.env.dist`). Check 2 checks those for real values. For each remaining file:

- `git check-ignore -v <file>` prints the matching `.gitignore` rule when the file is ignored, and nothing when it isn't;
- `git ls-files <file>` prints the path when the file is tracked (committed). A tracked file stays in git even if `.gitignore` lists it later.

**Confirm:** the file is not ignored, **or** it is tracked. Without git, read `.gitignore` yourself and say that tracking couldn't be checked.

**Severity:** `high`, unless **every** value in the file is a known-public value (see "Public by design") or blank; only then is it `low`. A single secret, password, unknown token or unclassifiable value makes it `high`. **Evidence:** the file and the line of its first non-public value (or line 1), plus the `.gitignore` line if a rule exists but doesn't match.

**Status:** `open`. If the file is tracked, its keys are already in git. Check 4 reports each one with rotation steps, so don't repeat them here.

### 4. `secrets.key-in-git-history`: a key was committed to git

Every secret ever committed is leaked to anyone with a copy of the repository, even if a later commit deleted it, and even if the file is still there today. This check finds each one.

**Subject:** the masked key, exactly as `maskSecret` returns it (for example `sk_live_4f…a9`).
**OWASP:** `A04:2025 Cryptographic Failures`. **fix_risk:** `low`, `may_break`: "Anything still using the old key stops working until you give it the new one."

**Find it** (skip with a note if this isn't a git repository). Run each command below exactly as written, as its own Bash call, from the project root. Replace `<RX>` with this pattern, copied exactly (it has no `{…}` on purpose, because braces make the command need approval):

```
(^|[^A-Za-z0-9_-])((sk|rk)_(live|test)_[A-Za-z0-9]+|sk-[A-Za-z0-9_-]+|AIza[0-9A-Za-z_-]+|AKIA[0-9A-Z]+|eyJ[A-Za-z0-9_-]+[.]eyJ[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+|sb_secret_[A-Za-z0-9_-]+|whsec_[A-Za-z0-9]+)|BEGIN[A-Z ]*PRIVATE KEY
```

and `<excludes>` with `-- . ':(exclude,glob)**/package-lock.json' ':(exclude,glob)**/yarn.lock' ':(exclude,glob)**/pnpm-lock.yaml' ':(exclude,glob)**/node_modules/**'`.

1. Commits that added or removed a key, on every branch:
   `git log --all --pickaxe-regex -S'<RX>' --format='%h %ad %s' --date=short --name-only <excludes>`
2. The exact lines in those commits. Write the short hashes from step 1 out as separate arguments:
   `git grep -n -I -o -E '<RX>' <hash1> <hash2> … <excludes>` prints `hash:file:line:match`. The first character of a match can be the one before the key (`=`, a quote or a space), so drop it. Ignore matches with fewer than 20 characters after the prefix, which aren't keys. For a `BEGIN … PRIVATE KEY` match, read the key with `git show <hash>:<path>` to mask it.
3. Env and key files ever committed, which can hold secrets without a known prefix (database passwords, session secrets):
   `git log --all --format='%h %ad %s' --date=short --name-only -- '*.env' '*.env.*' '**/.env*' '*service*account*.json' '*.pem' '*.key'`.
   Read each one with `git show <hash>:<path>`, but don't paste its contents into your reply.

**Confirm:** classify each distinct value with "Know your keys". Decode JWTs. Anon keys, Firebase web keys and other public keys are not findings, and neither are keys in test-only files. Collapse duplicates: one finding per distinct secret value, with evidence from the commit where it first appeared, `{ "file": "<path>", "line": <n>, "commit": "<short hash>" }`. Put the commit and its date in `impact`. Mask the value for `subject`, `title`, `impact`, `manual_steps` and your reply.

**Severity:** `high`. `critical` if the key is a Stripe `sk_live_`/`rk_live_` key or a Supabase service role key (`service_role` JWT or `sb_secret_`).

**Status:** `awaiting-user` until the user confirms the rotation (rotation rules below). You never mark it `fixed` on your own. `fix_plan`: "Rotate this key with your provider, then update it wherever your app runs. Removing it from git history is optional and comes after rotation, never instead of it." `manual_steps`: the click-by-click rotation steps for that provider from `references/rotation-steps.md`, with the masked key named in the first step, then "Tell me when you've rotated it", then the optional history purge. Read `references/rotation-steps.md` whenever you write a finding that needs rotation.

**In verify mode:** `PRESENT` while the key is still in any commit. Even after a purge makes it `GONE`, the finding stays `awaiting-user` until the user confirms rotation.

### 5. `secrets.leaked-key-unrotated`: a key that leaked earlier still isn't rotated

This check never comes from scanning. It is raised only from `.vibe-secure/rotations.json`: by an audit, when no key found in this run has the entry's fingerprint; or by the fix loop, when the code fix for a leaked key verifies `GONE` (rotation rule 6). Moving or deleting a key doesn't make an already-leaked key safe.

**Subject:** the masked key. **OWASP:** `A04:2025 Cryptographic Failures`. **Severity:** the severity stored in its rotation entry. **Status:** `awaiting-user`. **Evidence:** the stored evidence. **impact** starts "Found by an earlier check on <first_seen date>. The code no longer shows it, but the old key keeps working until you rotate it." `fix_plan`, `fix_risk` and `manual_steps` as in check 4.

## Rotation rules (`.vibe-secure/rotations.json`)

This file remembers leaked keys across audits, including `--full` ones. The shape and the general rules are in `<root>/shared/area-skill-template.md` ("Rotations"). Entries are matched on `check` + `fingerprint`; the masked `subject` is only for display. For this skill:

1. **Which keys need rotation:** every `secrets.key-in-git-history` finding (entry check `secrets.key-in-git-history`), and every key that leaked through check 1, or through check 2 in a tracked file, that this run does **not** also report under `secrets.key-in-git-history` (entry check `secrets.leaked-key-unrotated`). Each entry stores the key's fingerprint, its masked value as `subject`, the finding's severity and its evidence.
2. **Confirmed entry** with the same `check` + `fingerprint` → set that `key-in-git-history` finding's `status` to `fixed`. For a check 1 or 2 key with a confirmed entry, only the rotation is done: the code finding stays `open` until the code is fixed.
3. **Awaiting entry** → `key-in-git-history` findings get `awaiting-user`. Add an entry for any key that has none yet, with `first_seen` set to now.
4. **Awaiting entry whose fingerprint matches no key found in this run** → re-raise it as its own finding with the entry's check, subject, severity and evidence, `status: "awaiting-user"`.
5. **The user confirms a rotation** (fix loop): set the entry's `status` to `confirmed` and `confirmed_at` to now, and set the finding with the same `check` + `subject` as the entry to `fixed`.
6. **A check 1 or 2 finding turns `fixed` in the fix loop** while its key's entry is `awaiting-user` → add the `secrets.leaked-key-unrotated` finding built from the entry to `.vibe-secure/findings/secrets.json` right away, then re-validate and re-run `merge-findings`.
7. Audit mode writes `rotations.json` back with entries added, never removed. Verify mode doesn't touch it.

## Fixes

Before moving any key, read where it's used. Never print a key in full while fixing, and edit env files with the Edit tool rather than echoing values in commands.

**Server key in the browser (check 1). Move the work to the server:**

- **Next.js + Supabase service role:** the browser client uses the anon key, and admin work moves to a server-only module and a route handler that checks the user.
  ```js
  // lib/db-browser.js (browser)
  export const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  // lib/db-server.js (server only)
  import 'server-only';
  export const dbAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  ```
  Rename the variable in every `.env*` file and on the host (Vercel: Project → Settings → Environment Variables; Netlify: Site configuration → Environment variables). Update every server file that read the old name.
- **Vite or another single-page app + Supabase:** there's no server, so privileged work moves into a Supabase Edge Function (`supabase/functions/<name>/index.ts`, which reads `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`). The browser calls it with `supabase.functions.invoke('<name>')`.
- **LLM keys (OpenAI, Anthropic, Google AI) and Stripe secret keys:** create a server endpoint (Next: `app/api/<name>/route.js` reading `process.env.OPENAI_API_KEY`; Vite: a Supabase Edge Function, `netlify/functions/` or Vercel `api/`). The browser calls it with `fetch('/api/<name>', { method: 'POST', … })`. Remove `dangerouslyAllowBrowser` and the browser SDK client. The new endpoint needs a login check and a usage cap; point to `/vibe-secure:check-ai-features`.
- **Build config exposure:** remove the variable from `next.config` `env`, Vite `define`/`envPrefix`, `DefinePlugin` or Expo `extra`, and read it only in server code.
- `fix_risk` `high`. `may_break`: the features that called the provider from the browser stop working until they use the new endpoint, and the deployed app needs the new server-only variable set on the host.

**Hard-coded secret (check 2):** replace the literal with an environment read (`process.env.NAME`, `os.environ["NAME"]`), add `NAME=` (blank) to `.env.example`, and tell the user to put the value in `.env.local` (ignored) and on the host. Move key files out of the repository and load them from an env var or the host's secret store. `may_break`: the app won't start where the variable isn't set yet, and changing a session secret signs everyone out.

**Env file not ignored (check 3):** add these lines to `.gitignore` (keep existing lines):
```
.env
.env.*
!.env.example
```
If the file is tracked, run `git rm --cached <file>`. This stops tracking it and keeps it on disk. It doesn't remove the file from history, which is check 4. `may_break`: nothing in the app; teammates who clone the repo won't get the file and need their own copy.

**Key in git history or leaked earlier (checks 4 and 5):** only rotation fixes it. See `references/rotation-steps.md`.

## Not a finding

- The Supabase anon key / `sb_publishable_` key and the Supabase URL, even in `NEXT_PUBLIC_`/`VITE_` variables or written in browser code.
- A Firebase web `apiKey` in a Firebase config object.
- Stripe `pk_live_`/`pk_test_` keys, and the other browser keys listed under "Know your keys".
- `.env.example`, `.env.sample` or `.env.template` holding only blank values or placeholders.
- `process.env.X` / `os.environ["X"]` reads of a server-only variable in server code. That's the correct pattern, so list it under "already good".
- Secrets used only by tests or fixtures: files under `test/`, `tests/`, `__tests__/`, `spec/`, `fixtures/` or `__mocks__/`, `*.test.*`/`*.spec.*` files, `conftest.py`, and jest/vitest setup files, as long as no app code imports them. If such a value is a live-format key (`sk_live_`, `rk_live_`) or a service role key, it's still a real key: report it.
- Local-only development credentials in `docker-compose.yml` or dev config pointing at `localhost` (`postgres:postgres@localhost`).
- Anything under the excluded paths (`node_modules`, `.next`, `dist`, `build`, `out`, `.vercel`, `*.min.js`, lockfiles).

## What's already good

Collect lines like these for the report, but only for things you actually checked: "Your `.env` files are listed in `.gitignore`", "Your Stripe secret key is only read in server code", "The Supabase key in the browser is the public anon key, which is meant to be public", "No secret keys were found in your git history".

## Findings file

`.vibe-secure/findings/secrets.json`. The whole file, every time (with `"findings": []` when nothing is wrong). `generated_at` comes from `node -e "console.log(new Date().toISOString())"`:

```json
{ "area": "secrets", "generated_at": "<output of that command>", "mode": "audit", "findings": [ … ] }
```

Example of one finding (illustrative values):

```json
{
  "id": "secrets-2",
  "check": "secrets.key-in-git-history",
  "subject": "sk_live_4f…a9",
  "area": "secrets",
  "owasp": "A04:2025 Cryptographic Failures",
  "severity": "critical",
  "title": "Your live Stripe secret key can be read from your git history",
  "impact": "Commit abc1234 (2025-03-14) added config/payments.env with this key. The file was deleted later, but anyone with a copy of the repository can still read the key and use it to issue refunds or read your customers' payment details.",
  "evidence": [{ "file": "config/payments.env", "line": 2, "commit": "abc1234" }],
  "fix_plan": "Rotate this key with Stripe, then update it wherever your app runs. Removing it from git history is optional and comes after rotation, never instead of it.",
  "fix_risk": { "level": "low", "may_break": "Anything still using the old key stops working until you give it the new one." },
  "manual_steps": [
    "Open dashboard.stripe.com, make sure Test mode is off, and go to Developers → API keys.",
    "Next to the secret key sk_live_4f…a9, click ⋯ → Roll key, choose an expiry of \"now\", and confirm.",
    "Copy the new key into your server-only Stripe variable in your host's environment variables and in your local .env.local, then redeploy.",
    "Tell me when you've rotated it.",
    "Optional, only after rotating: remove the old key from git history (see the purge steps)."
  ],
  "status": "awaiting-user"
}
```
