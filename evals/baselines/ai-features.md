# RED baseline: ai-features (no plugin)

Date: 2026-10-23. Prompt: `claude -p "Check this project's AI/LLM features for security problems (OWASP Top 10 for LLM apps): browser code calling the AI provider directly, user prompts reaching tools the model can call, AI endpoints with no login, rate limit or token cap, and model output rendered as HTML or executed. Report only."`, run in a temp copy of each fixture (expected files and `history.sh` removed, git initialised with one commit), allowed tools `Read Grep Glob Bash(ls:*) Bash(cat:*) Bash(git:*)`, no `--plugin-dir`. Model forced with `ANTHROPIC_MODEL=claude-opus-4-8` because the user-level `model` setting is rejected in headless runs.

Fixtures: `next-openai-chatbot`, and `secure-baseline` as the false-positive check.

## What plain Claude got right

- `next-openai-chatbot`: saw the browser SDK client with `dangerouslyAllowBrowser`, the model-written `WHERE` clause run as SQL, the route with no login, and the missing `max_tokens` and rate limit. It also correctly noted that the chat messages render as React text, so there is no HTML sink today.
- `secure-baseline`: no false positives. It saw the login check, the per-user limit, the length cap, `max_tokens: 400` and the absence of tools, and it called the in-memory limiter best-effort on serverless hosts.

As in the other areas, the raw model finds the obvious holes. What it lacks is structure, separation of root causes and scope discipline.

## Failures the skill must address

| # | Baseline behaviour | Why it matters | Skill rule that addresses it |
|---|---|---|---|
| 1 | No findings file, no check ids, free-form subjects (`components/Chat.jsx:3-8`) | The orchestrator, merge, fix loop and scorer can't use it | Each check names its `check` id and subject (provider name; tool name; AI route path; sink name); the file is always written (`findings: []` when clean) and validated |
| 2 | Folded "browser calls the provider" into the key leak as one critical finding (LLM02) | The key leak is `check-secrets`' finding with its rotation; the browser call is a separate hole that survives a key swap (no server-side limits, prompt or model choice) | `ai.client-side-llm-call` is its own high finding with subject = provider; `impact` cross-references the key leak, which stays with `check-secrets` |
| 3 | Folded the tool exposure and the SQL built from the tool's argument into one finding | They need different fixes: removing or scoping the tool vs parameterising the query. Merge can't dedupe a mixed finding against `check-injection`'s | `ai.prompt-to-tool` is the exposure (user-steerable model + powerful tool + no allowlist or scoping); the SQL string is `check-injection`'s `inj.sql-string`. Report both, neither raises the other |
| 4 | Reported "no authentication" as its own high finding, separate from "no rate limit / token cap" | Duplicates `check-auth` and splits one cost hole into two | The missing login on a data route is `check-auth`'s; the cost hole (no login or no limit, plus no or huge `max_tokens`) is one `ai.no-usage-cap` finding per route |
| 5 | Scope creep: database credentials in `.env.local` | Duplicates `check-secrets` | "Stay in this area" hands it off in one line |
| 6 | Listed "output rendering is safe today but fragile" as a finding | A finding with nothing to fix trains users to ignore the report | Text bindings and sanitised markdown are under "Not a finding" and go to "What's already good" |
| 7 | No fix code, no "what might break", no provider spending-limit step | Moving a browser call to the server breaks the chat until the UI uses the new route; a spending limit is a dashboard-only setting | Per-check `fix_risk`/`may_break`, `manual_steps` for the provider's spending limit, and per-stack code in `references/ai-fixes.md` |

## Not observed, but guarded anyway (from the brief and dispatch)

- Indirect prompt injection (a tool that fetches pages, reads email or documents feeding a model that also has a write or send tool), and tools that act on an id the model chooses instead of the session user's id: both are `ai.prompt-to-tool` cases.
- Model output run as code, SQL or shell (`eval`, `new Function`, a model-written query run whole): `ai.output-as-html` when `check-injection` wouldn't report it.
- Markdown renderers with raw HTML on (`rehype-raw`, `markdown-it` `html: true`, `marked` into `innerHTML`): moved to `check-injection`'s `inj.xss-html` in the final review (Ruling R36), so the hand-off line covers them.
- False alarms on safe designs: ephemeral Realtime tokens, Firebase AI Logic, bring-your-own-key apps, a system prompt kept in server code, provider spending limits counted as a cap.
