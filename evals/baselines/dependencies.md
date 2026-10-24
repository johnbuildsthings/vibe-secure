# RED baseline: dependencies (no plugin)

Date: 2026-10-24. Prompt: `claude -p "Check this project's dependencies for security problems (OWASP A03 Software Supply Chain Failures): known vulnerable packages, suspicious or typosquatted packages, and missing or unsynced lockfiles. Report only."`, run in a temp copy of each fixture (expected files and `history.sh` removed, git initialised with one commit), allowed tools `Read Grep Glob Bash(ls:*) Bash(cat:*) Bash(git:*) Bash(npm audit:*)`, no `--plugin-dir`. Model forced with `ANTHROPIC_MODEL=claude-opus-4-8`.

Fixtures: `nextjs-supabase-leaky`, `secure-baseline` (false-positive check), `python-flask-generic` (requirements.txt path).

## What plain Claude got right

- `nextjs-supabase-leaky`: ran `npm audit`, reported lodash 4.17.15 as high with its GHSA ids, noticed lodash is never imported and suggested removing it; reported next (critical) and transitive postcss (high) and that the clean next version is a major bump.
- `python-flask-generic`: saw `flask>=3.0` is unpinned and there is no lockfile; no typosquats.
- All three: confirmed every `resolved` URL points at registry.npmjs.org and that package.json and the lockfile agree.

## Failures the skill must address

| # | Baseline behaviour | Why it matters | Skill rule that addresses it |
|---|---|---|---|
| 1 | No findings file, no check ids, free-form subjects | Orchestrator, merge, fix loop and scorer can't use it | Each check names its id and subject (package name; manifest path for lockfile problems); the file is always written and validated |
| 2 | **Hallucinated supply-chain attacks** (leaky and baseline): called `iceberg-js` (a real dependency of current `@supabase/storage-js`) an "injected / dependency-confusion" package, rated **Critical/High**; called `@next/swc-*` at 14.2.33 under `next` 14.2.35 (which is what `next`'s own optionalDependencies pin) "a tampered lockfile"; called identical `@supabase/*` versions, `@types/node@26` and `engines >=22` "implausible / forged"; told the user not to run `npm install` | All from out-of-date memory of the registry. A non-security user would panic, delete a valid lockfile, or distrust a correct app | `deps.suspicious-package` is `high` only with both a near-name to a listed popular package and an install script; everything else is `unverified`; "Not a finding" bans judging packages, versions or lockfile authenticity from memory |
| 3 | `secure-baseline`: `npm audit` didn't run (network), yet the report said "no known-vulnerable pinned version stood out" and listed versions as "patched" from memory | False all-clear; advisories change daily | "When the audit couldn't run": one `unverified` `deps.known-vuln` finding naming the reason; never claim "no vulnerable packages" without an audit result; never call versions patched from memory |
| 4 | Flask: unpinned `flask>=3.0` and "no lockfile" rated **High** as two findings, plus a third "transitive deps unmanaged" finding | Inflated and split: one root cause | `deps.no-lockfile` is `medium`, one finding per manifest (`requirements.txt`), listing every unpinned line |
| 5 | Flask: commented on `debug=True` and on `smoke.mjs` having no package.json | Scope creep / noise | "Stay in this area" hands config issues to `check-config`; only apps in `stack.json` with a manifest are checked |
| 6 | One finding per advisory family mixed with per-package rows; no plain-English "what this means for your app" per package | Users need one item per thing to upgrade | One finding per vulnerable package, highest severity, advisories listed in `impact`, and a usage-based "what it means here" sentence without overclaiming |
| 7 | Fix advice not tied to risk (major bump mentioned in passing) | A major upgrade can break the app | Fixes: `npm audit fix` is low risk; a major-version bump is `fix_risk: high` with "run your tests"; no-fix-available case covered |

## Not observed, but guarded anyway (from the brief and dispatch)

- Typosquat names one edit from a popular package with `hasInstallScript` (high); git/tarball/unknown-host sources (unverified).
- Gitignored or out-of-sync lockfiles (medium, same id); monorepo apps in subfolders (subject `apps/web/package.json`).
- Dev-only vulnerabilities skipped (`--omit=dev`); malware advisories are critical.
