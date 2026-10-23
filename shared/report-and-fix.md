# Report and fix loop

This is the one place the report format and the fix loop are defined (design spec §4). Two callers follow it:

- **`security-check`** (the orchestrator), for every area it ran.
- **An area skill run alone** (for example `/vibe-secure:check-secrets`), for its own area only.

An area skill that was **dispatched** by the orchestrator (its prompt says `dispatched: audit` or `dispatched: verify`) never follows this file. It writes its findings file, replies to the orchestrator and stops.

Paths below are relative to the project being audited. `<root>` is the plugin root.

## Before the report

1. Every findings file you wrote passes `node <root>/scripts/validate-findings.mjs <file>`. Fix and re-validate until it does. Never present a report built on a file that fails.
2. Run `node <root>/scripts/merge-findings.mjs .`. It writes `.vibe-secure/merged.json` with `findings` (ranked), `worth_a_look` (the `unverified` ones), `counts` and `skipped_files`.
3. Build the report from `merged.json`, not from memory.
   - **Area skill run alone:** `merged.json` can also hold older results from other areas. Show only findings whose `area` is yours, and recount from those. If other areas' results exist, add one line at the end: "Earlier results for other areas are still in `.vibe-secure/findings/`. Run `/vibe-secure:security-check` for a fresh full report."
   - **`skipped_files`** is non-empty: say "Couldn't check <area>: its results file was invalid", with the first error. Never drop an area silently.

## Report

Show the report in the chat and save the same text to a file:

- `security-check` → `.vibe-secure/report.md`
- an area skill run alone → `.vibe-secure/report-<area>.md`, so it doesn't overwrite a full report.

### Rules

- **Summary line first**, with counts per severity, e.g. "2 critical · 1 high · 0 medium · 1 low, plus 1 worth a look".
- **Findings ordered by severity**, most severe first. Each one has:
  - a headline stating the consequence in plain English, in the second person ("Anyone can read your users' emails"). Never a check id, OWASP code or tool name in the headline;
  - a short explanation (from `impact`), with jargon explained in a few words the first time it appears;
  - **proof**: every `file:line`, or the live request (method, URL, status) and what the response showed;
  - the OWASP category on its own sub-line ("Category: OWASP A04:2025 Cryptographic Failures");
  - the fix (`fix_plan`) and its risk: "Low risk", or "Needs care: <may_break>";
  - the manual steps, numbered, when there are any, and the status when it isn't `open` (e.g. "Waiting for you: rotate this key").
- **No proof, no finding.** Items with `severity: "unverified"` go only in a separate **Worth a look** list, with no severity label, each with one sentence saying what to check and why it couldn't be proven.
- **Secrets are always masked** (`sk_live_4f…a9`), in the report, the chat, the saved file and any command you show. Use `maskSecret` from `<root>/scripts/mask.mjs`.
- **Already fixed:** findings whose `status` is `fixed` (for example a rotation you confirmed in an earlier session) are listed in their own short section and left out of the summary counts. Recount from the remaining findings.
- **What's already good** comes last: the specific things that are done correctly ("Your Stripe secret key is only read on the server"), so the user doesn't "fix" correct code. Area skills return these lines with their results.
- **Say what wasn't checked.** If a stack-specific check was skipped because the stack wasn't recognised, or a check couldn't run (no git repo, no network), say so in one plain sentence. A clean result reads "No problems found in <areas>", followed by what was checked and what's already good. Never an empty report.
- If live checks ran, add one line: "Made N read-only requests to M hosts."

### Example

Illustrative values only:

```
Security check: secrets
2 critical · 0 high · 0 medium · 0 low, plus 1 worth a look

CRITICAL: Anyone visiting your site can take full control of your database
Your Supabase "service_role" key (an admin password for your database) is
exposed to the browser: vite.config.ts copies it into the JavaScript every
visitor downloads. With it, a stranger can read, change or delete every row,
ignoring all your security rules.
  Proof: .env.production:5 (SUPABASE_SERVICE_KEY = eyJhbGciOi…Qk)
         vite.config.ts:14 (define exposes it to browser code)
         src/api/admin.ts:3 (browser code uses it)
  Category: OWASP A04:2025 Cryptographic Failures
  Fix: Use the public anon key in the browser. Move admin work into a
       Supabase Edge Function that reads the service key on the server.
  Risk: Needs care: the admin screens stop working until their calls go
        through the new function.
  You must also: rotate the key (steps below). The old one is already public.

CRITICAL: A live Stripe key is still readable in your git history
Commit abc1234 (2025-03-14) added config/payments.env with a live Stripe
secret key. The file was deleted later, but anyone with a copy of the
repository can still read the key and use it to issue refunds or read your
customers.
  Proof: config/payments.env:2 in commit abc1234 (sk_live_4f…a9)
  Category: OWASP A04:2025 Cryptographic Failures
  Fix: Only you can fix this, by rotating the key in Stripe.
  Waiting for you:
    1. Open dashboard.stripe.com → Developers → API keys.
    2. ...

Worth a look
- An AIza… key in src/maps/loader.ts looks like a Google Maps browser key.
  Check that it is restricted to your domain in Google Cloud → Credentials.

Already fixed
- The OpenAI key sk-proj-9c…2e was rotated (you confirmed it on 2025-03-10).

What's already good
- Your .env files are listed in .gitignore.
- Your OpenAI key is only read in server code.
```

## Fix loop

Skip this whole section if the user asked for a report only ("report only", "don't fix anything", "just tell me"). End with one line saying they can ask you to fix things later.

1. **Ask how to proceed:** fix all critical issues now, go one at a time, or pick specific ones. If the user's message already approves fixes ("fix everything, I approve every fix"), take that as the answer and don't ask again.
2. **Before each fix**, say in 1–2 sentences what will change and what may behave differently afterwards.
3. **Low-risk fixes** (`fix_risk.level: "low"`: move a key to an env var, add headers, verify a webhook signature) are approved once per batch. List the batch, get one yes, then apply it.
4. **High-risk fixes** (`fix_risk.level: "high"`: RLS policies, auth changes, CORS tightening, moving a browser call to the server) are approved one at a time. Before asking, search the code for everything the fix could break (callers, client queries, pages that use the thing) and report what you found with `file:line`.
   **Blanket approval:** an explicit "I approve every fix" (or "fix everything, I approve all fixes") covers high-risk fixes too, so don't stop to ask one by one. Before applying each high-risk fix, still show its `may_break` and what your search found, then apply it.
5. **Verify after each fix.** Re-run that finding's check for that subject only:
   - `security-check` dispatches the owning area skill with `dispatched: verify <check> <subject>`;
   - an area skill run alone runs its own `verify <check> <subject>` mode;
   - if the finding's evidence includes a URL, also re-probe it with `<root>/scripts/safe-fetch.mjs`.

   Mark it `fixed` only if the check replies `GONE`. If it replies `PRESENT`, say so, show the new evidence, and either try once more or leave it `open` and explain why.
   Record status changes in the owning area's file (`.vibe-secure/findings/<area>.json`): edit only the `status` field, re-run `validate-findings` on that file, then re-run `merge-findings`. If the user declines a fix, set it to `skipped`.
6. **Manual steps** (rotate a leaked key, purge git history, change a dashboard-only setting) are given as numbered, click-by-click instructions from the area skill's references. A leaked key stays `awaiting-user` until the user tells you they rotated that key. Approving fixes is not the same as confirming a rotation, and a code change never un-leaks a key. Never mark a rotation `fixed` on your own.
   **When the user confirms a rotation** (naming the key, or "I rotated all of them"): in `.vibe-secure/rotations.json` set that entry's `status` to `confirmed` and `confirmed_at` to the current time (`node -e "console.log(new Date().toISOString())"`); set the matching finding's `status` to `fixed` in the area's findings file; validate; re-run `merge-findings`. The entry is what keeps the confirmation across later audits, including `--full` ones. The contract is in `<root>/shared/area-skill-template.md` ("Rotations").
7. **Final summary:** what was fixed (with how it was verified), what is still open or skipped and why, and the user's manual to-do list (each `awaiting-user` item with its steps). Update the saved report file to match.

Throughout the loop: don't commit, push or deploy unless the user asks. Don't touch `.vibe-secure/` files other than the `status` fields and the files the scripts write.
