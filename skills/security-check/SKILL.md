---
name: security-check
description: Use when the user wants a full security audit of their app, covering leaked keys, database rules, login and access checks, injection, payments, AI features, configuration, dependencies and (optionally) read-only checks of the live site, followed by a plain-English report and an optional guided fix loop.
disable-model-invocation: true
---

# Security check

This skill runs the whole audit. It doesn't run checks itself: each of the nine areas has its own skill (`skills/check-<area>/SKILL.md`), run by a separate agent. This skill sets up the workspace, asks about the live site, dispatches the areas, then builds one report from their results and, unless the user asked for a report only, walks them through fixing what was found.

Areas: `secrets`, `database-rules`, `auth`, `injection`, `payments`, `ai-features`, `config`, `dependencies`, `live`.

Write everything the user reads in plain English, in the second person ("your app"), with jargon explained in a few words.

## Ground rules

- **Commands:** one plain command per Bash call. `&&`, `;`, `||`, `$?`, `$(…)`, `{…}` and pipes into other programs need extra approval and headless runs refuse them. Use the Read, Grep, Glob and Write tools for files. Don't write helper scripts or scratch files.
- **Time stamps** come from `node -e "console.log(new Date().toISOString())"`. Never guess one.
- **Secrets are always masked** (`sk_live_4f…a9`) in the chat, the report and every command you show.
- **Don't audit an area yourself,** and never write or rewrite an area's findings file, except what the fix loop allows: `status` edits, the rotation reminder finding (Rotations rule 6 in `<r>/shared/area-skill-template.md`) and confirmations in `rotations.json`. If an area failed, it is reported as "couldn't check <area>".
- **Don't commit, push or deploy** unless the user asks.

## Run

1. **Roots.** The plugin root `<r>` is two levels up from this skill's base directory ("Base directory for this skill: …/skills/security-check"). The project root `<p>` is the absolute path of the current directory: run `node -e "console.log(process.cwd())"`. Use both as absolute paths in every command and dispatch prompt below.
2. **Fresh workspace:** `node <r>/scripts/init-workspace.mjs <p> --full`. This clears the previous run's findings, report, live scope and request log, and keeps `.vibe-secure/rotations.json` (the keys the user still has to rotate, or has confirmed).
3. **Stack:** `node <r>/scripts/detect-stack.mjs <p>`, then read `.vibe-secure/stack.json`. Tell the user what you found in one plain sentence per app ("`apps/web`: a Next.js app using Supabase and Stripe, hosted on Vercel"). If an app's framework is `unknown`, say only the general checks run there: "I don't recognise the framework of `<path>`, so only the general checks run there; the stack-specific checks are skipped." Keep that sentence for the report.
4. **Live URL (optional).**
   - If the user's message says "no live URL" (or "no URL", "skip live"), skip live checks: write no scope file.
   - If the message gives a URL **and** says the app is theirs and they may test it, that is the confirmation.
   - Otherwise ask once: "Do you have a deployed copy of this app I should also check from the outside, with read-only requests? If so, send its URL and confirm it's yours and you're allowed to test it. Or say 'no live URL'." Stop until they answer. Never pick a URL yourself (from `package.json`, a README, `vercel.json`).

   With a confirmed URL, build the scope exactly as `<r>/skills/check-live/SKILL.md` describes under "Scope" → "Run alone", steps 2–5: check the URL belongs to this project (a loopback URL the user named, such as `http://localhost:3000`, is their own machine and skips this check), add the backend hosts found in the code, apply the loopback rules, and list every host for the user. Hosts are written as the URL's `host` (lower-case hostname, plus `:port` only for a non-default port). Then write `.vibe-secure/live-scope.json` with the Write tool, with `url` exactly as the user gave it, scheme included:

   ```json
   { "url": "https://shop.example.com", "hosts": ["shop.example.com", "abcd1234.supabase.co"], "confirmed_by_user": true, "confirmed_at": "<time-stamp command output>" }
   ```

5. **Dispatch the areas.** In a single message, start one `Agent` call (`subagent_type: "general-purpose"`) for each of these eight areas, so they run in parallel: `secrets`, `database-rules`, `auth`, `injection`, `payments`, `ai-features`, `config`, `dependencies`. Dispatch all eight every time: each area skill decides itself whether it applies, and writes `"findings": []` with a one-line reason when it doesn't. The prompt for each, with `<area>` filled in and nothing else added:

   ```
   dispatched: audit. Project root: <p>. Plugin root: <r>. Read <r>/skills/check-<area>/SKILL.md and follow it.
   ```

   When all eight have replied, and only if you wrote `live-scope.json`, dispatch `live` the same way, **alone**, so its requests stay sequential. Without a scope file, don't dispatch `live`; the report says live checks weren't run because no URL was given.

   Keep every agent's reply: its counts, its "already good" lines, the checks it skipped and why, and any problem it noticed for another area. The report uses them.
6. **Validate.** For every area you dispatched, `.vibe-secure/findings/<area>.json` must exist. Run `node <r>/scripts/validate-findings.mjs <p>/.vibe-secure/findings/<area>.json` on each. If `live.json` is missing or fails, report "Couldn't check live" with the error straight away: never dispatch `live` a second time, because a second run resets the request log and probes again, which breaks the 50-requests-per-run cap. If another area's file is missing or fails, dispatch that area once more with the same prompt plus one sentence giving the error ("Your last run's findings file failed validation: <first error>. Write a valid file."), then validate again. If it still fails, that area is reported as "Couldn't check <area>" with the error. Never drop an area silently, and never fix its file yourself.
7. **Merge:** `node <r>/scripts/merge-findings.mjs <p>`. It writes `.vibe-secure/merged.json` and skips any file that is still invalid (listed in `skipped_files`).

## Report

Follow `<r>/shared/report-and-fix.md`, sections "Before the report" and "Report", for **every** area at once. That file holds the format, the rules and the example. The orchestrator-specific parts:

- Build the report from `.vibe-secure/merged.json`, not from memory or the agents' replies. Use the replies only for the "already good" lines, the skipped checks, the live request count and the "couldn't check" lines.
- Title it "Security check: full audit". Right under the summary line, put the stack sentence from step 3 of Run.
- **Say what wasn't checked**, one plain sentence each:
  - every app with an `unknown` framework: "stack-specific checks were skipped" for it (keep the sentence from Run step 3);
  - every area that didn't apply, with its reason ("No Stripe code was found, so payment checks were skipped");
  - every check an area skipped (no git repository, the npm registry couldn't be reached);
  - every area that failed: "Couldn't check <area>: <error>";
  - live: either "Live checks weren't run: no URL was given", or check-live's line "Made N read-only requests to M hosts."
- Problems an agent noticed for another area aren't findings. If that area didn't report them, add them to **Worth a look**.
- Show the report in the chat and save the same text to `.vibe-secure/report.md` with the Write tool.
- **Report only** (the user said "report only", "don't fix anything", "just tell me"): stop here, after the report is saved, with one line saying they can ask you to fix things later.

## Fix loop

Follow `<r>/shared/report-and-fix.md`, section "Fix loop", steps 1–7, for every finding in the report. The orchestrator-specific parts:

- **Start:** if `.vibe-secure/live-scope.json` exists, reset the live request log once, before the first fix, so the 50-request cap covers this fix session: `node -e "require('fs').writeFileSync('<p>/.vibe-secure/live-requests.log','')"`. Never reset it again during the loop.
- **Applying a fix:** you make the code change yourself, following the owning area skill's "Fixes" section (and the `references/` file it points to for the stack) together with the finding's `fix_plan`. The owning area is the finding's `area`. Make the smallest change that removes the problem, and keep every existing feature, export and file name working: the fix must not break the app.
- **Verify** each fix by dispatching the owning area skill in verify mode, one `Agent` call (`subagent_type: "general-purpose"`) per finding, with this prompt:

  ```
  dispatched: verify <check> <subject>. Project root: <p>. Plugin root: <r>. Read <r>/skills/check-<area>/SKILL.md and follow it.
  ```

  Verify dispatches for different code areas may run in parallel.

  **Live evidence:** if the finding's evidence includes a URL, the live side must be re-checked too. Dispatch `check-live` with the same prompt (`dispatched: verify <check> <subject>`, `check-<area>` = `check-live`), **one at a time, never in parallel**, after the code verify. check-live rebuilds the exact request (method and headers), applies its own `GONE` rules and handles a missing scope or the request cap. Never judge a live finding from your own bare `safe-fetch` request: a plain GET without the original headers can look "gone" while the site is still exposed. Mark the finding `fixed` only when **both** the code verify and the live verify reply `GONE`. A code fix (a migration, a config edit) reaches the live site only after the user applies or deploys it: if the code verify replies `GONE` but the live verify replies `PRESENT`, say it is fixed in the code and needs a deploy (or the migration applied), and leave it `open`.
- **Recording status:** the only edits you make to area files are the `status` field, the rotation reminder finding (rule 6) and `rotations.json` confirmations (step 6 of the shared file). The merged finding can come from more than one area file (code and live evidence for the same `check` + `subject`). Edit the `status` in every `.vibe-secure/findings/<area>.json` that holds a finding with that `check` + `subject`, validate each edited file, then re-run `merge-findings`.
- **Keys found in git history** (`secrets.key-in-git-history`) are never marked `fixed` by you. Deleting the line, a later commit or even a history purge doesn't un-leak the key, and approving fixes ("I approve every fix") is not a rotation. It stays `awaiting-user`, with its rotation steps in the to-do list, until the user tells you they rotated that key. The same goes for every `awaiting-user` entry in `.vibe-secure/rotations.json`.
- **A fix command you aren't allowed to run** (for example `npm install`): use an equivalent you can run, or make the change by editing files, and tell the user which command they should run afterwards. For `npm install <name>@<version>`: set that exact version in `package.json`, then run `npm audit fix --package-lock-only` to update `package-lock.json` without installing anything. Say before running it that it needs to reach the npm registry and also applies every other non-major fix it finds in the lockfile (name those packages afterwards). If the registry can't be reached, leave the finding `open` and give the command in the to-do list. If there's no safe equivalent, do the same.
- **Major dependency upgrades** (`fix_risk.level: "high"` in `dependencies`) are high-risk fixes: a blanket "I approve every fix" covers them, but before applying each, name the package, the old and new major version and its `may_break`, and list every major upgrade you applied in the final summary, with a note to run the app's tests or click through the main pages.
- **End:** re-run `merge-findings`, then give the final summary (step 7 of the shared file) and save it, with the updated report, to `.vibe-secure/report.md`.
