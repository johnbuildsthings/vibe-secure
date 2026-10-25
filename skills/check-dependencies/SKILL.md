---
name: check-dependencies
description: Use when auditing an app's third-party packages for supply-chain risk, such as npm packages with known vulnerabilities (npm audit), look-alike or suspicious packages that run install scripts, dependencies pulled from git URLs or unknown hosts, and missing, gitignored or out-of-date lockfiles (including unpinned Python requirements).
disable-model-invocation: true
---

# Check dependencies

## What this protects against

Most of the code your app runs was written by other people and downloaded as packages. If one of those packages has a known security hole, attackers already know how to use it; if a package is a look-alike of a popular one, it may run malicious code the moment it's installed; and without a lockfile, every install can quietly pull different (possibly compromised) versions than the ones you tested.

OWASP Top 10 (2025): `A03:2025 Software Supply Chain Failures` for every check in this skill.

## Applies when

Every app in `stack.json` that has a `package.json` (all three checks). Python apps (`requirements.txt`, `pyproject.toml`) get only the pinning check in `deps.no-lockfile`; say in the report that known-vulnerability checks were skipped for them (unless `pip-audit` is installed: see check 1). The framework doesn't matter: apps whose framework is `unknown` get the same checks.

## How to run

Follow the run contract in `<root>/shared/area-skill-template.md` (Part 2). In short:

- `<root>` = two levels up from this skill's base directory (or `Plugin root:` in a dispatch prompt). Project root = the current directory, or the `Project root:` from a dispatch prompt. In that case, use that path wherever a command below says `.`.
- **Mode:** `audit` unless the request says `verify <check> <subject>`.
- **Time stamps:** `node -e "console.log(new Date().toISOString())"`. Never guess.
- **Alone, audit:** `node <root>/scripts/init-workspace.mjs .`, then `node <root>/scripts/detect-stack.mjs .` if `.vibe-secure/stack.json` is missing → run the checks → write `.vibe-secure/findings/dependencies.json` (always, `"findings": []` when clean) → `node <root>/scripts/validate-findings.mjs .vibe-secure/findings/dependencies.json` until it passes → follow `<root>/shared/report-and-fix.md` (stop after the report if the user asked for a report only).
- **`dispatched: audit`:** run the checks, write and validate the file, reply with counts, "already good" lines and skipped checks. No report, no fix loop.
- **`verify <check> <subject>`:** no init or detect-stack (read `stack.json`, `package.json` or the Python manifest directly); re-run that one check for that subject, reply `PRESENT` or `GONE` plus evidence, write nothing.
- **Dispatched project root:** substitute it for `.` in every command.
- **Search scope:** never look inside `node_modules`, `.next`, `dist`, `build`, `out`, `.vercel`, `.vibe-secure` or `*.min.js`. **Exception for this skill:** you do read lockfiles (`package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `poetry.lock`, `uv.lock`, `Pipfile.lock`). They are large: use Grep on them (for a package's entry, `hasInstallScript`, `resolved`) instead of reading them whole.
- **Commands:** one plain command per Bash call: no `&&`, `;`, `||`, `$?`, `$(…)`, `{…}` or pipes into other programs, because those need extra approval and may be refused. Use the Read and Grep tools for files. Don't write helper scripts or scratch files, in the project or anywhere else. Don't run `npm install`, `npm ci` or `npm audit fix` during an audit: they change the project.

**Rotations:** don't apply here. This skill has no rotation findings and never reads or writes `.vibe-secure/rotations.json`.

### Stay in this area

Report only the three checks below. If you notice any of these, mention it in one line of your reply, name the skill, and write no finding:

- a token in a committed `.npmrc` (`_authToken=…`) or any other key → `check-secrets`;
- your own code calling a dangerous function (`_.template` with user input, `eval`, SQL built from strings) → `check-injection`. A vulnerable *package* is yours; how your code uses it only shapes the `impact` text;
- framework settings (headers, debug, source maps) → `check-config`.

## Checks

### 1. `deps.known-vuln`: a package you ship has a known security hole

**Subject:** the vulnerable package's name, bare (`minimist`, `@scope/name`). One finding per vulnerable package, not per advisory.
**OWASP:** `A03:2025 Software Supply Chain Failures`. **fix_risk:** see "Fixes" (low for a fix inside the same major version, high for a major-version upgrade or no fix).

**Run the audit,** once per lockfile (an app's own folder, or the repo root for a workspace monorepo whose apps share one lockfile). Call Bash with a `timeout` of 300000 ms, because the audit asks the npm registry and can take minutes:

- `package-lock.json` or `npm-shrinkwrap.json`: `npm audit --json --omit=dev --fetch-timeout=60000 --fetch-retries=1` (add `--prefix <app path>` when the lockfile isn't in the project root).
- `pnpm-lock.yaml`: `pnpm audit --json --prod`. Its JSON has an `advisories` map (one entry per advisory, with `module_name`, `severity`, `title`, `github_advisory_id` or `url`, `patched_versions`, `findings[].paths`); group the entries by `module_name` to get one finding per package.
- `yarn.lock`: `yarn npm audit --json --environment production` (Yarn 2+), which prints one JSON object per line (each with `value` = package name and `children` holding `ID`, `Issue`, `Severity`, `Vulnerable Versions`, `Tree Versions`); or `yarn audit --json --groups dependencies` (Yarn 1), one JSON object per line where `type: "auditAdvisory"` lines carry `data.advisory` (`module_name`, `severity`, `title`, `url`, `patched_versions`).
- `bun.lock` / `bun.lockb` only: no audit command is used here; write the "audit couldn't run" finding.
- If the command is refused, the tool isn't installed, or the output has a shape you don't recognise, use the "audit couldn't run" rule below. Don't guess at an unfamiliar format.

`npm audit` exits with status 1 when it finds vulnerabilities; that's a normal result, not a failure. Read the JSON's `vulnerabilities` object. Each key is a package; `isDirect` says whether `package.json` lists it; `via` holds the package's own advisories (objects with `title`, `url` (the GHSA link), `severity`, `range`) and, as plain strings, other vulnerable packages it pulls in; `nodes` lists its exact lockfile keys (`node_modules/postcss`, `apps/web/node_modules/x`); `effects` lists the packages that depend on it (its parents); `fixAvailable` is `true`, `false`, or `{ name, version, isSemVerMajor }`. The package-level `severity` also counts the severities it inherits from vulnerable packages it pulls in, so don't use it (see "Severity").

**Which packages get a finding:** every package whose `via` contains at least one advisory object (its own hole). A package that is in the list only because it depends on another vulnerable one (its `via` holds only strings) gets no finding of its own; the vulnerable package it pulls in has one. A package that isn't direct (pulled in by something you installed) still gets its own finding: follow `effects` up until you reach a package with `isDirect: true`, say in `impact` that this dependency of yours brings it in, and name it in the fix.

**Dev-only packages are skipped:** `--omit=dev` already leaves out `devDependencies`. Don't add findings for them.

**Severity:** the highest `severity` among the package's **own** advisory objects in `via` (ignore the string entries, and ignore the package-level `severity`, which also counts holes inherited from the packages it pulls in; otherwise a parent would repeat its child's finding at the child's severity). Map it one to one: `critical` → `critical`, `high` → `high`, `moderate` → `medium`, `low` → `low`, `info` → `low`. Don't raise or lower it because of how your code uses the package; explain that in `impact` instead. An advisory titled "Malware in …" or "Embedded malicious code" means the package itself is malicious: `critical` whatever npm says, and `manual_steps` say to rotate every key that was on a machine (your laptop, CI) where it was installed.

**Evidence:** `{ "file": "package-lock.json", "line": <n> }` where `n` is the line of the package's entry: take the exact key from the audit's `nodes` (the first one) and Grep the lockfile for it in quotes followed by a colon (`"node_modules/<name>":`). If you can't find it (another lockfile format, an unusual layout), use the line of the dependency in `package.json`. For an app in a subfolder, both paths are from the project root (`apps/web/package-lock.json`).

**Impact, in plain English for this app:**

- List the advisories: GHSA id (last part of the `url`) and title, highest severity first, e.g. "GHSA-xxxx-xxxx-xxxx: Prototype pollution in merge". Mention how many more if there are many.
- Say in a few words what each kind of hole lets an attacker do ("prototype pollution: crafted input can change how the rest of your app behaves, sometimes leading to code running on your server"; "ReDoS: a crafted string can freeze your server").
- **Then say what it means here, without overclaiming.** Grep your app code (not `node_modules`) for imports of the package (`from '<name>'`, `require('<name>')`, `'<name>/…'`) and, when the advisory names a function (`_.template`, `merge`, `parse`), whether your code calls it, and with what input. Three honest outcomes:
  - your code calls the named function with input from visitors: say so with `file:line`;
  - your code imports the package but not the named function, or only with fixed values: "Your code doesn't appear to call the affected function, so the risk today is lower, but anything that does later is exposed";
  - nothing in your code imports it (it's pulled in by another package, or listed but unused): "Your own code doesn't import it; the risk depends on how <parent package> uses it, which can't be checked from here". If a direct dependency is never imported, add that removing it is also a fix.

**When the audit couldn't run:** no network, a registry error (`ENOTFOUND`, `EAI_AGAIN`, `ETIMEDOUT`, a JSON `error` object instead of `vulnerabilities`), no lockfile (`ENOLOCK`), the command timed out, or the tool isn't available. Write **one** finding per lockfile (or per app without one) with `check: "deps.known-vuln"`, `severity: "unverified"`, `subject` = the manifest path (`package.json`, `apps/web/package.json`), empty `evidence`, and an `impact` naming the reason in plain words ("The npm registry couldn't be reached, so your packages weren't checked for known holes"). Never write or say "no vulnerable packages" unless an audit actually ran and returned zero.

**Python:** if `pip-audit` is installed (`pip-audit --version` succeeds), you may run `pip-audit -r requirements.txt -f json` with the same timeout and the same rules (subject = the package name, evidence = its line in `requirements.txt`). Otherwise skip known-vulnerability checks for Python apps and say so in your reply; don't write a finding for the skip.

### 2. `deps.suspicious-package`: a package might be a look-alike or run code when installed

**Subject:** the package name as it appears in `package.json`. One finding per package.
**OWASP:** `A03:2025 Software Supply Chain Failures`. **fix_risk:** `low` (`may_break`: if the package was the one you meant, whatever imports it fails until you install the real one).

Look at `dependencies` **and** `devDependencies` here: install scripts run on every machine that installs the project, including your laptop and your build server.

**Find it:** read `references/popular-packages.md`, then for each dependency:

- **Near-name:** its name is one edit away from a listed popular package and is not itself a well-known package (the reference lists real look-alikes such as `preact`). Evidence: its line in `package.json`.
- **Install script:** its `package-lock.json` entry has `"hasInstallScript": true` (Grep the lockfile for `hasInstallScript` with a few lines of context before each match to see whose entry it is). Only `package-lock.json` records this reliably; `yarn.lock` and `pnpm-lock.yaml` usually don't (pnpm's `requiresBuild` is often missing), so for those projects the install-script signal is unknown: a near-name there stays `unverified`, and say that the install-script check needs a `package-lock.json`. Packages the reference lists as having install scripts for good reasons (native builds like `esbuild`, `sharp`, `bcrypt`, `prisma`) don't count. Evidence: the lockfile line.
- **Unusual source:** the version in `package.json` is a git URL (`git+https://…`, `git://…`, `github:user/repo`, `user/repo`), an `http(s)://…` tarball, or `file:` outside the project; or its lockfile `resolved` URL points at a host other than `registry.npmjs.org`, `registry.yarnpkg.com` or a registry set in the project's `.npmrc`. These skip npm's checks, and the code behind them can change at any time.

**Severity:**

| What you found | Severity |
|---|---|
| Near-name **and** install script, on the same package | `high`: a package that imitates a popular name and runs code on install is the typical typosquat. `title` says it may be malicious, `impact` names the package it looks like, `manual_steps` say to check the package's npm page and, if it's malicious, rotate every key on machines that installed it |
| Near-name only, install script only (on a package you don't recognise), or an unusual source | `unverified` ("worth a look"): say what to check (the package's npm page, its download count, who publishes it, the repository it points to) |

Never mark something `high` on the name alone, and never call a package malicious without both signals. A package that `npm audit` flags as malware is check 1's `critical`, not this check.

### 3. `deps.no-lockfile`: installs can pull different code than you tested

**Subject:** the manifest path from the project root: `package.json` (root app), `apps/web/package.json` (a subfolder app), `requirements.txt`, `pyproject.toml`. One finding per manifest.
**OWASP:** `A03:2025 Software Supply Chain Failures`. **Severity:** `medium` in every case below. **fix_risk:** `low` (`may_break`: the first install after the fix may move some packages to newer versions inside the ranges you allow; run your app and its tests once).

**Find it, for each app with a `package.json`:**

- **No lockfile:** none of `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb` in the app's folder, nor in a parent folder that is a workspace root (a `package.json` with `workspaces`, or `pnpm-workspace.yaml`). Evidence: line 1 of `package.json`.
- **Lockfile not committed:** in a git repository, `git check-ignore -v <lockfile path>` prints a rule (the lockfile is gitignored), or `git ls-files <lockfile path>` prints nothing while the file exists (never committed). Evidence: the `.gitignore` line that ignores it, or line 1 of the lockfile. Not a git repository: skip this part and say so.
- **Out of sync:** a package in `package.json` `dependencies` or `devDependencies` is missing from the lockfile, or listed there with a different range. For `package-lock.json` (v2/v3), compare `package.json` with its own entry under `"packages"`: `""` for the app at the lockfile's folder, or `"<app path>"` (such as `"apps/web"`, relative to the lockfile) for a workspace app whose lockfile is at the workspace root. Then check that each name has a `"node_modules/<name>"` entry, or `"<app path>/node_modules/<name>"` for a workspace app (npm puts version clashes there). For `pnpm-lock.yaml`, compare with `importers` → `"."` or `"<app path>"` → `dependencies` / `devDependencies`. For `yarn.lock`, check that each `name@range` appears. `npm ci` refuses to install from an out-of-sync lockfile, so deploys fail or fall back to fresh versions. Evidence: the `package.json` line of the first mismatched package; list all of them in `impact`.

**Python:**

- `requirements.txt` with any package line not pinned with `==` (`flask`, `flask>=3.0`, `requests~=2.31`). Skip comments, blank lines and options (`-r`, `-c`, `--hash`, `--index-url`). A line installing from a URL or git (`pkg @ git+https://…`, `git+https://…#egg=pkg`, `-e git+…`, `https://…/pkg.tar.gz`) counts as unpinned unless it names a full commit hash (`@<40-hex-character sha>`); list it in the same finding. Evidence: the first unpinned line; list them all in `impact`. A file where every line uses `==` (or a commit hash) is fine.
- `pyproject.toml` that lists dependencies (`[project] dependencies`, `[tool.poetry.dependencies]`) when the same folder has no lock file (`poetry.lock`, `uv.lock`, `pdm.lock`, `Pipfile.lock`) and no `requirements.txt` with every line pinned. Ranges inside `pyproject.toml` are normal and not a finding when one of those exists. Evidence: the line where its dependencies start.

**Impact:** without a lockfile (or with one that isn't used), each install picks whatever versions are newest within your ranges, so a package that was compromised or broken yesterday can land in your next deploy without any change on your side, and you can't tell which versions are running.

## Fixes

For `deps.known-vuln`, read `fixAvailable` exactly like this:

- **`fixAvailable: true`**: the fix fits inside the version range in `package.json`. `fix_plan` = "Run `npm audit fix`". `fix_risk: low`, `may_break`: "Small version bump; run the app once to check."
- **An object with `isSemVerMajor: false`**: a fixed version exists but is outside the range `package.json` allows (often an exact pin such as `"4.17.15"`), so plain `npm audit fix` leaves it unchanged. `fix_plan` = "Run `npm install <name>@<version>`" with `name` and `version` from `fixAvailable` (for a transitive package, `name` is the direct dependency to upgrade). `fix_risk: low`, `may_break`: "Small version bump; run the app once to check."
- **An object with `isSemVerMajor: true`**: `fix_plan` = "Run `npm install <name>@<version>`" for that one package. `fix_risk: high`, `may_break`: "A new major version can change how the package works: run your app's tests (or click through the main pages) after upgrading, and check its changelog."
- Never suggest `npm audit fix --force`: it applies every major upgrade in the project at once.
- **No fix available** (`fixAvailable: false`): `fix_plan` says no patched version exists yet; options are replacing the package, removing it if unused, or (for a transitive one) an `overrides` entry in `package.json` once a fixed version of it exists. `fix_risk: high`.
- **`deps.suspicious-package`:** remove it (`npm uninstall <name>`) and install the package you meant; for an unusual source, switch to the published npm version. Never run its install script to "test" it.
- **`deps.no-lockfile`:** run `npm install` once (or `pnpm install`, `yarn`) to create the lockfile, commit it, remove the `.gitignore` line that hides it, and use `npm ci` in builds. Out of sync: run `npm install` and commit the updated lockfile. Python: pin each line with `==` to the version you run today (`pip freeze` shows it), or use a lock tool (`uv lock`, `poetry lock`, `pip-compile`).

**In the fix loop**, apply each known-vuln fix whose `fixAvailable` names a version with its targeted `npm install <name>@<version>`, so each finding's change is clear and can be verified on its own. When you do run `npm audit fix` (for the `fixAvailable: true` findings), say beforehand that one run clears all of those findings together, list them, and verify each one afterwards. Applying a fix changes `package.json` and the lockfile; re-run the matching check in `verify` mode afterwards (for `deps.known-vuln`, re-run `npm audit` and look for that package).

## Not a finding

- Vulnerabilities in `devDependencies` only (test runners, linters, build tools on your machine).
- A transitive package listed only because it depends on another vulnerable package (`via` holds only strings): the vulnerable one has the finding.
- Install scripts on well-known packages that build native code or download binaries (`references/popular-packages.md`).
- Packages from a private registry configured in `.npmrc`, scoped packages from your own organisation, and `workspace:` / `file:` links to folders inside the repo.
- Version ranges (`^`, `~`) in `package.json` when a committed, in-sync lockfile exists: the lockfile pins them.
- Outdated packages with no known advisory. Old isn't vulnerable.
- **Anything judged from your memory of what a package "should" look like.** Your knowledge of the npm registry is out of date: versions newer than you know of, a package depending on something you don't recognise, sibling packages sharing one version number, a framework pinning its native binaries to a slightly older patch version, or high `engines` requirements are all normal. They are not signs of a tampered lockfile and not findings, not even under "worth a look". Only the signals listed in the checks above count, and only the audit tool decides whether a version has known holes: never list versions as "patched" or "vulnerable" from memory.
- Anything under the excluded paths.

## What's already good

Collect lines like these, only for things you actually checked: "Your lockfile is committed and matches package.json", "npm audit found no known holes in the packages you ship", "None of your dependencies look like misspelled popular packages", "All your packages come from the npm registry", "Every Python requirement is pinned to an exact version".

## Findings file

`.vibe-secure/findings/dependencies.json`. The whole file, every time (with `"findings": []` when nothing is wrong). `generated_at` comes from `node -e "console.log(new Date().toISOString())"`:

```json
{ "area": "dependencies", "generated_at": "<output of that command>", "mode": "audit", "findings": [ … ] }
```

Ids are `dependencies-1`, `dependencies-2`, … in this run. Example of one finding (illustrative values):

```json
{
  "id": "dependencies-1",
  "check": "deps.known-vuln",
  "subject": "minimist",
  "area": "dependencies",
  "owasp": "A03:2025 Software Supply Chain Failures",
  "severity": "critical",
  "title": "A package your app ships has a known hole that lets crafted input change how your server behaves",
  "impact": "minimist 1.2.5 has 1 known advisory: GHSA-xvch-5gv4-984h Prototype Pollution in minimist (critical). Prototype pollution means crafted input can change built-in objects for the rest of your app, which can lead to code running on your server. Your own code doesn't import minimist; it comes in through another package you installed, so whether visitors' input reaches it can't be checked from here.",
  "evidence": [
    { "file": "package-lock.json", "line": 412 }
  ],
  "fix_plan": "Run npm audit fix, which moves minimist to 1.2.8 (same major version).",
  "fix_risk": { "level": "low", "may_break": "Small version bump; run the app once to check." },
  "manual_steps": [],
  "status": "open"
}
```
