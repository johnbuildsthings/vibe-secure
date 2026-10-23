---
name: check-injection
description: Use when auditing an app for injection holes, such as SQL built by pasting in request data or AI tool arguments, user or database content rendered as raw HTML, eval or shell commands run on request data, and server code that fetches a URL the visitor chose.
disable-model-invocation: true
---

# Check injection

## What this protects against

Injection happens when your app pastes text it got from a visitor into something that runs it: a SQL query, a page's HTML, a piece of JavaScript or Python, or a web request your server makes. The visitor's text then stops being data and becomes instructions, so they can read your whole database, run scripts in other users' browsers, run code on your server, or make your server fetch internal addresses for them. Text an AI model writes counts as visitor text too, because a visitor can steer the model with what they type (prompt injection).

OWASP: `A05:2025 Injection` for `inj.sql-string`, `inj.xss-html` and `inj.eval`; `A01:2025 Broken Access Control` for `inj.ssrf` (OWASP 2025 folded server-side request forgery into broken access control).

## Applies when

Always: every app in `stack.json`, whatever its framework, language or database. Run it once per app.

- Checks 1, 3 and 4 look at server code (API routes, server actions, server components, `+server`/`+page.server` files, loaders and actions, edge and cloud functions, Express/Flask/FastAPI/Django handlers, SQL functions in migrations). For a browser-only app, check 1 still covers Supabase SQL functions and `.or()`/`.filter()` strings, check 3 covers browser `eval` (see its severity rule), and check 4 doesn't apply: say so in one line.
- Check 2 looks at browser code and server templates.
- Python apps (Flask, FastAPI, Django or plain scripts) are in scope for checks 1, 2 (server templates), 3 and 4. When the framework is `unknown`, recognise routes yourself (`@app.route`, `@app.get`, `@router.post`, Django `urls.py` views, Express `app.get`) and say that framework-specific route detection was skipped.

If an app has no code that reads request data (a static site with no server code and no raw-HTML rendering), write `"findings": []` and say so in one line.

## How to run

Follow the run contract in `<root>/shared/area-skill-template.md` (Part 2). In short:

- `<root>` = two levels up from this skill's base directory (or `Plugin root:` in a dispatch prompt). Project root = the current directory, or the `Project root:` from a dispatch prompt. In that case, use that path wherever a command below says `.`.
- **Mode:** `audit` unless the request says `verify <check> <subject>`.
- **Time stamps:** `node -e "console.log(new Date().toISOString())"`. Never guess.
- **Alone, audit:** `node <root>/scripts/init-workspace.mjs .`, then `node <root>/scripts/detect-stack.mjs .` if `.vibe-secure/stack.json` is missing → run the checks → write `.vibe-secure/findings/injection.json` (always, `"findings": []` when clean) → `node <root>/scripts/validate-findings.mjs .vibe-secure/findings/injection.json` until it passes → follow `<root>/shared/report-and-fix.md` (stop after the report if the user asked for a report only).
- **`dispatched: audit`:** run the checks, write and validate the file, reply with counts, "already good" lines and skipped checks. No report, no fix loop.
- **`verify <check> <subject>`:** no init or detect-stack (read `stack.json`, `package.json` or the Python manifest directly); re-run that one check for that subject, reply `PRESENT` or `GONE` plus evidence, write nothing.
- **Dispatched project root:** substitute it for `.` in every command.
- **Search scope:** never look inside `node_modules`, `.next`, `dist`, `build`, `out`, `.vercel`, `.vibe-secure`, `*.min.js` or lockfiles.
- **Commands:** one plain command per Bash call: no `&&`, `;`, `||`, `$?`, `$(…)`, `{…}` or pipes into other programs, because those need extra approval and may be refused. Use the Read and Grep tools for files. Don't write helper scripts or scratch files, in the project or anywhere else.

**Rotations:** this skill has no rotation findings, so it never reads or writes `.vibe-secure/rotations.json`.

### Stay in this area

Report only the four checks below. One root cause is one finding. If you notice any of these, mention it in one line of your reply, name the skill, and write no finding:

- an AI feature that lets the model's output drive a tool, query or action at all (the prompt-to-tool exposure) → `check-ai-features` (`ai.prompt-to-tool`). Your finding is the SQL, HTML, eval or fetch built from the tool's arguments;
- a route with no login check, or an AI endpoint with no login or rate limit → `check-auth` / `check-ai-features`. You only *use* "no login" to pick a severity (see below); you never report it;
- tables with RLS off or open policies, or a browser query whose safety depends on them → `check-database-rules`;
- a leaked or hard-coded key, a committed env file → `check-secrets`;
- a webhook without a signature check, or a price taken from the request → `check-payments`;
- missing `Content-Security-Policy` or other headers, debug mode → `check-config`;
- a vulnerable package version (for example an old template library) → `check-dependencies`.

Another area's hole can make yours worse (an XSS is easier to plant when anyone can write the table). Say so in `impact` in one sentence, but don't raise your severity because of it.

## What counts as request data

Use this for every check. **Request data** is anything a visitor controls:

- the body, query string, route params, headers and cookies (`req.body`, `await req.json()`, `formData`, `searchParams`, `params`, `req.query`, `request.args`, `request.form`, `request.json`, FastAPI parameters);
- a server action's arguments, a tRPC or GraphQL procedure's input, a callable function's `data`;
- **an AI model's output, including tool-call arguments** (`JSON.parse(call.function.arguments)`, `tool_use.input`, `toolCall.args`), because a visitor can steer the model with what they type;
- for checks 2 and 3 only: values read back from the database or storage that users wrote (comments, display names, messages, uploaded file contents).

Follow the value through variables and helper functions until it reaches the sink, or until it is made safe (parameterised, sanitised, matched against a fixed list, converted with `Number()`/`int()` and checked). Values that come only from your own code (constants, env vars, a fixed map keyed by request data) are not request data.

## When it counts as "reachable without login"

Check 1 uses this to choose between high and critical. Find the route, server action or function that runs the vulnerable code (for an AI tool, the route that runs the tool). Read the section "How to tell whether a login is checked" in `<root>/skills/check-auth/SKILL.md` and apply it: if that entry point has no session check by that definition, the code is reachable without login. Don't copy those rules into your finding and don't report the missing login; `check-auth` owns it.

## Checks

### 1. `inj.sql-string`: a visitor can rewrite your database queries

**Subject:** the name of the function that holds the query, bare: a named helper (`findUser`), a Python view function (`list_invoices`), a server action as `action:<functionName>` (`action:deleteNote`). When the SQL is built from an AI tool's arguments, the **tool name** (`query_db`). For a Supabase SQL function called through `.rpc()`, `rpc:<function>`. Only when the handler has no meaningful name (Next.js `GET`/`POST` exports, an anonymous Express callback), use the route path as users call it (`/api/invoices`).
**OWASP:** `A05:2025 Injection`. **fix_risk:** `low` when the fix only swaps string building for parameters (the same inputs give the same results); `high` when the feature relied on the visitor or the model sending SQL fragments (a `where` or `orderBy` clause), because those requests stop working. Say which in `may_break`.

**Find it:** query text built from request data by `${…}` in a plain (untagged) template literal, `+` concatenation, Python f-strings, `%` formatting or `.format()`, then run by:

- JS: `pool.query`, `client.query`, `sql.unsafe`, `db.query`, `connection.execute`/`.query` (mysql2), `db.prepare(…)`/`db.exec` (better-sqlite3), `db.all`/`db.run`/`db.get` (sqlite3), `sequelize.query`, Prisma `$queryRawUnsafe` / `$executeRawUnsafe` / `Prisma.raw(…)`, Drizzle `sql.raw(…)`, TypeORM `query(…)`, Neon `sql.query(…)` (or `neon()` called as a function) with the text built from request data, `@vercel/postgres` `db.query`;
- raw fragments inside query builders, which the builder pastes in as SQL: Knex `.raw`, `.whereRaw`, `.orderByRaw`, `.havingRaw`, `.joinRaw`, `.selectRaw` with `${…}` or `+` instead of `?` bindings; Kysely `sql.raw(…)`, `sql.lit(…)`, `sql.ref(…)` / `sql.id(…)` given request data; Sequelize `literal(…)` / `Sequelize.literal(…)`; TypeORM QueryBuilder `.where(\`… ${q} …\`)`, `.andWhere`/`.orWhere`/`.having` with interpolation, and `.orderBy(…)` / `.addOrderBy(…)` / `.select(…)` given a column from the request;
- Python: any `.execute(…)`, `.executemany(…)`, `.executescript(…)` (on a cursor **or** a connection), SQLAlchemy `text(…)` and `session.execute(…)`, Django `.raw(…)`, `.extra(…)`, `RawSQL(…)`, `cursor.execute(…)`;
- SQL functions (migrations, `supabase/migrations/**`, `*.sql`) that run `EXECUTE` on text built with `format('… %s …', arg)` or `'…' || arg || '…'`, where the argument comes from the caller (for example through `.rpc('<function>', { arg })`);
- Supabase `.or(…)` or `.filter(…)` whose **filter string** is built from request data (`.or(\`name.ilike.%${q}%,email.ilike.%${q}%\`)`): the visitor can add their own filter conditions by typing commas and dots;
- Supabase calls whose **column** comes from request data: `.select(userString)` (the visitor picks any column, including related tables through embedded selects), `.order(userColumn)`, or a column argument such as `.eq(userColumn, value)` / `.textSearch(userColumn, q)`. The **value** argument of these methods is sent separately and is safe (see "Not a finding").

Identifiers count too: a column or sort direction from the request pasted into `ORDER BY`, a table name, or a `LIMIT` that isn't converted to a number.

**Confirm:** you can point at the line that builds the string and trace at least one interpolated part back to request data (above) without it being parameterised, matched against a fixed list, or converted to a number first.

**Severity:** `high`. `critical` when the code is reachable without login (see above), because then anyone can read or change your database with a browser and no account. `medium` for a Supabase `.or()` / `.filter()` string or a column taken from the request: the visitor can only bend that one query on that table. If the query runs with a user-scoped client (anon or publishable key, or the user's session), row level security still limits which rows come back. If it runs with a `service_role` client, it doesn't, so say in `impact` that the visitor may read every row of that table.

A SQL function with `EXECUTE format(… %s …)` or `'…' || arg` follows the high/critical rule, and its reachability is decided by the **function**, not by where `.rpc()` is called: anyone can call it through the API with the public key. It is reachable without login unless the migrations revoke `EXECUTE` on it from `anon` and `public` (Supabase grants it to `anon` for functions in the `public` schema by default), or the function body stops before the `EXECUTE` when `auth.uid()` is null.

### 2. `inj.xss-html`: a visitor can run their own script in other people's browsers

**Subject:** the sink name, bare: `dangerouslySetInnerHTML`, `v-html`, `{@html}`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `.html()` (jQuery); for links, `href` or `src`; for server templates, the escape-bypass as written (`|safe`, `Markup`, `{{{ }}}`, `<%- %>`, `autoescape false`, `html_safe`). One finding per sink name per app; put every place it is used unsafely in `evidence`.
**OWASP:** `A05:2025 Injection`. **fix_risk:** `low` (the text shows up as plain text or with unsafe tags removed). In `may_break`, say what formatting users may lose (links, bold, embedded images) if the field is meant to hold HTML.

**Find it:**

- Raw-HTML sinks in browser code: React `dangerouslySetInnerHTML={{ __html: x }}`, Vue `v-html`, Svelte `{@html x}`, Angular `[innerHTML]` with `bypassSecurityTrustHtml`, and DOM `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, jQuery `.html(x)` / `.append(x)` with a string of HTML.
- Markdown or rich text turned into HTML (`marked`, `markdown-it`, `showdown`, `remark-html`, `react-markdown` with `rehype-raw`) and then put into one of those sinks.
- Links and sources taking a URL from user or database data (`href={user.website}`, `src={item.url}`, `window.location = …`) with no check that it starts with `http:` or `https:`: a `javascript:` URL runs a script when clicked.
- Server templates with escaping turned off on user or database data: Jinja `|safe`, `{% autoescape false %}`, `Markup(x)`; Handlebars/Mustache `{{{ x }}}`; EJS `<%- x %>`; Pug `!{x}`; Django `|safe`, `mark_safe(x)`; Rails `html_safe`/`raw`; an HTML string built with an f-string, `+` or a template literal from user data and sent as HTML. A Flask view that returns a string is sent as `text/html` by default, and so is Express `res.send(string)`; elsewhere look for `Content-Type: text/html` (`new Response(html, { headers: { 'Content-Type': 'text/html' } })`). Returning JSON (`jsonify`, `Response.json`, `res.json`) is not this.

**Confirm:** the value reaching the sink comes from request data, the URL (`location`, `searchParams`), the database or storage where users can write it, or an AI model's output, **and** it isn't passed through a sanitiser or a complete escape first (see "Not a finding"). Content only you write (a constant, a markdown file in the repo, a CMS only admins can edit) doesn't count.

**Severity:** `high`, for every sink kind above, including `javascript:` links.

### 3. `inj.eval`: a visitor can run their own code on your server

**Subject:** the sink name, bare: `eval`, `new Function`, `vm.runInContext` (or whichever `vm.run*` / `vm.Script` call), `setTimeout` (string argument), `exec` (Python `exec` or Node `child_process.exec`), `execSync`, `spawn` or `execFile` (with `shell: true`), `os.system`, `subprocess` (with `shell=True`), `pickle.loads`, `yaml.load`, `render_template_string`, `$where`.
**OWASP:** `A05:2025 Injection`. **fix_risk:** `low` when the code only evaluated data (replace `eval` with `JSON.parse`, `yaml.load` with `yaml.safe_load`); `high` when the feature evaluates expressions, formulas or commands, because the replacement supports less. Say what stops working in `may_break`.

**Find it:** request data (including model output) reaching:

- JS: `eval(…)`, `new Function(…)`, `vm.runInContext` / `runInNewContext` / `runInThisContext` / `new vm.Script(…)` (the `vm` module is not a sandbox), `setTimeout`/`setInterval` with a string, `require(…)` or `import(…)` of a path from the request, MongoDB `$where` with a string;
- shell commands: `child_process.exec`/`execSync`, or `spawn`/`spawnSync`/`execFile`/`execFileSync` with `{ shell: true }`, where the command or an argument includes request data; Python `os.system`, `os.popen`, `subprocess.*(…, shell=True)`. These run on your server just like `eval`;
- Python: `eval(…)`, `exec(…)`, `pickle.loads` / `pickle.load` / `dill` / `joblib.load` on uploaded or request bytes; `yaml.load(…)` with `Loader=yaml.Loader` or `yaml.UnsafeLoader`, `yaml.unsafe_load(…)`, or a plain `yaml.load(x)` when the PyYAML version pinned in the manifest is older than 5.1 (newer versions refuse or default to safe loading); `render_template_string(…)` whose **template text** is built from request data (`render_template_string(f"<p>{name}</p>")`), because template injection runs Python.

**Confirm:** you can trace the evaluated value back to request data, an upload, or model output. A value that only comes from your own code is not a finding.

**Severity:** `critical` in server code, because whoever controls the text controls your server. In browser-only code (`eval` of a URL parameter or of another user's data in the page), `high`: it runs in visitors' browsers, not on your server; say so in `impact`.

### 4. `inj.ssrf`: a visitor can make your server fetch any address for them

**Subject:** the route path as users call it, with dynamic parts as `:name` (`/api/preview`, `/api/proxy/:id`). For a server action, `action:<functionName>`; for an AI tool, the route that runs it.
**OWASP:** `A01:2025 Broken Access Control`. **fix_risk:** `high`: an allowlist stops every address not on it, so say which URLs users could fetch before and which will now fail.

**Find it:** server code that makes a request to a URL taken from request data (including model output): `fetch`, `axios`, `got`, `ky`, `node-fetch`, `undici`, `http.get`/`https.get`, `superagent`, Python `requests`, `httpx`, `urllib.request.urlopen`, `aiohttp`; headless browsers (`page.goto` in Puppeteer or Playwright); image or PDF tools given a URL; link previews, "import from URL", image proxies, and user-saved webhook URLs your server later calls. A URL where the visitor controls the **host** (`fetch(\`https://${req.query.host}/x\`)`, a full URL from the body) counts. A fixed host with a visitor-controlled path or query does not, but only when the visitor's part comes after a `/` that follows the host (`https://api.example.com/items/${id}`). Without that slash the visitor can change the host: `https://api.example.com${path}` with `path` = `.evil.net/x` or `@evil.net/x` goes to `evil.net`, so it counts.

**Confirm:** the server-side request's URL or host comes from request data, and nothing restricts it before the request: an allowlist means parsing the URL (`new URL(u)`, `urlparse`) and comparing the **hostname exactly** to a fixed list (and the protocol to `https:`). These don't count as an allowlist: `startsWith('https://example.com')` (passes `https://example.com.evil.net`), `includes('example.com')`, a regex without anchors, or a block list of `localhost`/`127.0.0.1` strings (other spellings and DNS names point inside too). Fetches made from browser code are not SSRF.

**Severity:** `high`. From your server, the visitor can reach internal services, cloud metadata addresses (`169.254.169.254`, which can hand out cloud credentials) and admin panels that trust requests from inside.

## Fixes

Read `references/injection-fixes.md` before writing any `fix_plan` or applying a fix. It has, per stack: parameterised queries (pg, mysql2, better-sqlite3, Prisma, Drizzle, Knex, Kysely, Sequelize, TypeORM, Neon, Supabase, Python DB-API, SQLAlchemy, Django), a safe `EXECUTE format` with `%L`/`%I` or `USING` and how to lock a SQL function to signed-in users, safe Supabase filters and columns, allowlisted sort columns, a typed AI tool instead of a model-written `WHERE` clause, DOMPurify and sanitize-html for each framework, safe markdown rendering, a URL-scheme check for links, server templates with escaping on, replacements for `eval` and shell commands, `yaml.safe_load`, and an SSRF allowlist.

Before writing `may_break`, search for the callers of the code you will change (browser code calling the route, other helpers calling the function, places that store HTML in the field) and name them with `file:line`. If nothing else depends on the behaviour, say so.

## Not a finding

- **Parameterised SQL:** Prisma `` $queryRaw`… ${x}` `` and `$executeRaw` used as tagged templates, `Prisma.sql`; the Drizzle `` sql`… ${x}` `` tag; `postgres`/`@vercel/postgres`/Neon `` sql`…` `` tags; `pg` with `$1` placeholders and a values array; mysql2 and sqlite with `?` placeholders; Neon `sql.query('… $1', [x])`; Knex, Kysely, Sequelize and TypeORM builder calls with values passed as arguments (`.where('status', status)`, `.where('status = :s', { s })`), and Knex `*Raw` methods with `?` bindings (`knex.raw('… ?', [x])`, `.whereRaw('total > ?', [n])`); the Supabase query builder with values passed as arguments and fixed column names (`.eq('id', id)`, `.ilike('name', \`%${q}%\`)`, `.in('id', ids)`, `.not('status', 'eq', s)`, `.textSearch('body', q)`), because those values are sent separately and can't add conditions; Python `execute("… %s …", (x,))` or `execute("… ?", (x,))` with a parameter tuple (the `%s` there is a placeholder, not `%` formatting); SQLAlchemy `text("… :name")` with parameters; the Django ORM. The unsafe look-alikes are listed in check 1.
- **Interpolation of values you control:** constants, env vars, a column chosen from a fixed map, a number converted with `Number()`/`parseInt()`/`int()` and checked, a list of placeholders built from `ids.map((_, i) => '$' + (i + 1))`.
- **SQL functions** using `format('%I', …)`, `format('%L', …)`, `quote_ident`, `quote_literal`, or `EXECUTE … USING …`.
- **React, Vue, Svelte and Angular text bindings** (`{value}`, `{{ value }}`): they escape by default. So do `jsonify`/`Response.json`, and Jinja, Django and Nunjucks templates with autoescape on (the default for `.html` files in Flask and Django).
- **Escaped or sanitised input in a sink:** DOMPurify (`DOMPurify.sanitize`, `isomorphic-dompurify`), `sanitize-html`, `xss`, `rehype-sanitize`, Python `bleach.clean` / `nh3`, or an escape function that encodes all five of `& < > " '` before the value reaches the sink. Open the helper to check. A hand-written escape that skips `&`, `<` or `>` is no escape, so report it; one that skips only quotes is fine in element content and unsafe inside an attribute value.
- **Content only you write:** markdown or MDX files in the repo, constants, an admin-only CMS. Say under "worth a look" if you can't tell who writes it.
- `JSON.parse`, `yaml.safe_load`, `yaml.load(x, Loader=yaml.SafeLoader)`, `ast.literal_eval`, `child_process.execFile`/`spawn` with an argument array and no `shell: true`, `subprocess.run([...])` without `shell=True`.
- `render_template_string` with a fixed template and request data passed as context variables (`render_template_string(TEMPLATE, name=name)`): autoescape applies and the template itself doesn't change.
- Browser `fetch` of a user-given URL, and server fetches to a fixed host where the visitor's part comes after a `/` following the host.
- Migrations, seed scripts, test files (`*.test.*`, `*.spec.*`, `tests/`, `conftest.py`), build and developer scripts that never see request data, and anything under the excluded paths.

## What's already good

Collect lines like these, only for things you actually checked: "Every query goes through the Supabase query builder, which sends values separately from the SQL", "Your product lookup uses placeholders, so typed text can't change the query", "Your comments are cleaned with DOMPurify before they are shown as HTML", "React escapes every other value on the page", "Your server only fetches fixed addresses, never one the visitor sends", "Nothing in the app calls `eval` or runs shell commands with visitor input".

## Findings file

`.vibe-secure/findings/injection.json`. The whole file, every time (with `"findings": []` when nothing is wrong). `generated_at` comes from `node -e "console.log(new Date().toISOString())"`:

```json
{ "area": "injection", "generated_at": "<output of that command>", "mode": "audit", "findings": [ … ] }
```

Ids are `injection-1`, `injection-2`, … in this run. Example of one finding (illustrative values):

```json
{
  "id": "injection-1",
  "check": "inj.sql-string",
  "subject": "findInvoices",
  "area": "injection",
  "owasp": "A05:2025 Injection",
  "severity": "critical",
  "title": "Anyone can read or wipe your whole database by typing into the invoice search",
  "impact": "findInvoices pastes the search text straight into the SQL query, and the route that calls it doesn't need a login. Typing a quote followed by SQL lets a stranger read every table, including other customers' invoices and emails, or delete them.",
  "evidence": [
    { "file": "src/server/invoices.ts", "line": 12 },
    { "file": "src/app/api/invoices/lookup/route.ts", "line": 5 }
  ],
  "fix_plan": "Send the search text as a query parameter (WHERE status = $1 with [status]) instead of pasting it into the SQL string.",
  "fix_risk": { "level": "low", "may_break": "Nothing visible: the same searches return the same invoices. src/app/invoices/page.tsx:22 is the only caller and keeps working." },
  "manual_steps": [],
  "status": "open"
}
```
