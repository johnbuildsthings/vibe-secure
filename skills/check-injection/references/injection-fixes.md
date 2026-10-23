# Injection fixes

Ready-to-adapt patterns for `check-injection` fixes. Replace table, column, function and route names with the real ones. Use the library the app already uses; never add a second database client or template engine. Add a new package (DOMPurify, sanitize-html) only for the sanitising fixes, and say so in the fix plan.

## Check 1: `inj.sql-string`

The rule everywhere: the SQL text is fixed, and visitor values travel separately as parameters. Identifiers (columns, sort direction, table names) can't be parameters, so pick them from a fixed list.

### node-postgres (`pg`), Neon, `@vercel/postgres`

```js
// Before: pool.query(`SELECT * FROM invoices WHERE status = '${status}'`)
const { rows } = await pool.query('SELECT * FROM invoices WHERE status = $1', [status]);
```

`postgres` (porsager), Neon's `neon()` and `@vercel/postgres` `sql` are safe when used as a **tag**: `` await sql`SELECT * FROM invoices WHERE status = ${status}` ``. Calling them as a function with a pre-built string is not.

### mysql2, better-sqlite3, sqlite3

```js
const [rows] = await conn.execute('SELECT * FROM invoices WHERE status = ?', [status]); // mysql2
const rows = db.prepare('SELECT * FROM invoices WHERE status = ?').all(status);         // better-sqlite3
db.all('SELECT * FROM invoices WHERE status = ?', [status], callback);                  // sqlite3
```

### Prisma

```ts
// Before: prisma.$queryRawUnsafe(`SELECT * FROM "Invoice" WHERE status = '${status}'`)
const rows = await prisma.$queryRaw`SELECT * FROM "Invoice" WHERE status = ${status}`;
// Better, when the query is simple:
const rows = await prisma.invoice.findMany({ where: { status } });
```

If `$queryRawUnsafe` must stay (a dynamic query), pass values as extra arguments: `prisma.$queryRawUnsafe('SELECT * FROM "Invoice" WHERE status = $1', status)`.

### Drizzle and Knex

```ts
import { sql, eq } from 'drizzle-orm';
await db.select().from(invoices).where(eq(invoices.status, status));          // builder
await db.execute(sql`SELECT * FROM invoices WHERE status = ${status}`);       // tag; never sql.raw(userText)

await knex('invoices').where({ status });                                     // Knex builder
await knex.raw('SELECT * FROM invoices WHERE status = ?', [status]);          // Knex raw with bindings
```

### Sort columns and other identifiers

```js
const SORTABLE = { date: 'created_at', amount: 'amount_cents' };
const column = SORTABLE[req.query.sort] ?? 'created_at';
const direction = req.query.dir === 'asc' ? 'ASC' : 'DESC';
await pool.query(`SELECT * FROM invoices ORDER BY ${column} ${direction} LIMIT $1`, [limit]);
```

Only the values from the fixed map reach the SQL text, so this is safe even though it uses `${}`.

### Python DB-API (`sqlite3`, `psycopg`, `pymysql`, `mysqlclient`)

```python
# Before: db.execute(f"SELECT id, name FROM customers WHERE name = '{name}'")
rows = db.execute("SELECT id, name FROM customers WHERE name = ?", (name,)).fetchall()  # sqlite3
cur.execute("SELECT id, name FROM customers WHERE name = %s", (name,))                  # psycopg, pymysql
```

The placeholder style depends on the driver (`?` for sqlite3, `%s` for psycopg and the MySQL drivers). Never put the value into the string with `%`, `.format()` or an f-string.

### SQLAlchemy and Django

```python
from sqlalchemy import text
session.execute(text("SELECT * FROM customers WHERE name = :name"), {"name": name})

Customer.objects.filter(name=name)                                            # Django ORM
Customer.objects.raw("SELECT * FROM app_customer WHERE name = %s", [name])    # Django raw with params
```

### Supabase SQL functions (`.rpc()`)

```sql
-- Before: EXECUTE format('SELECT * FROM %s WHERE note = ''%s''', tbl, search);
-- %I quotes an identifier, %L quotes a literal; USING passes values as parameters.
RETURN QUERY EXECUTE format('SELECT * FROM %I WHERE note = $1', tbl) USING search;
```

If the table name comes from the caller, also check it against a fixed list inside the function (`IF tbl NOT IN ('notes', 'tasks') THEN RAISE EXCEPTION 'not allowed'; END IF;`). If the query isn't dynamic at all, drop `EXECUTE` and write plain SQL in the function body.

### Supabase `.or()` / `.filter()` strings

```js
// Before: .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
const safe = q.replace(/[,()."\\:%]/g, ' ').trim();  // remove filter syntax and wildcards from the visitor's text
const { data } = await supabase.from('contacts').select('id, name').or(`name.ilike.%${safe}%,email.ilike.%${safe}%`);
// Or, for a single column, use the builder: .ilike('name', `%${safe}%`)
```

`may_break`: searches for text containing commas, dots or brackets match a little more loosely.

### AI tools that run SQL

Never let the model write SQL text. Give the tool typed arguments and build the query yourself:

```js
const tools = [{
  type: 'function',
  function: {
    name: 'find_invoices',
    description: 'Find the signed-in customer\'s invoices by status',
    parameters: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['paid', 'open', 'void'] } },
      required: ['status'],
    },
  },
}];

const { status } = JSON.parse(call.function.arguments);
if (!['paid', 'open', 'void'].includes(status)) throw new Error('bad status');
const { rows } = await pool.query(
  'SELECT id, amount_cents, status FROM invoices WHERE customer_id = $1 AND status = $2',
  [user.id, status], // user from the verified session, never from the model
);
```

`fix_risk` is `high`: questions the model could answer with free-form SQL before ("invoices over 100 from March") stop working until you add arguments for them. Say so in `may_break`. The wider prompt-to-tool exposure is `check-ai-features`' finding.

## Check 2: `inj.xss-html`

The rule: render visitor text as text. When it really must contain HTML, sanitise it right before the sink.

### Plain text (best when the field isn't meant to hold HTML)

```jsx
<p className="bio">{profile.bio}</p>             {/* React */}
<p class="bio">{{ profile.bio }}</p>             <!-- Vue -->
<p class="bio">{profile.bio}</p>                 <!-- Svelte -->
el.textContent = profile.bio;                    // DOM
```

Add `white-space: pre-line` in CSS if line breaks should show.

### Sanitise with DOMPurify (field holds HTML on purpose)

```jsx
import DOMPurify from 'isomorphic-dompurify'; // works in server components and the browser; use 'dompurify' in browser-only apps

<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(post.body) }} />
```

Vue: `<div v-html="DOMPurify.sanitize(post.body)" />` (or a computed property). Svelte: `{@html DOMPurify.sanitize(post.body)}`. DOM: `el.innerHTML = DOMPurify.sanitize(html)`.

On the server (Node), `sanitize-html` is an alternative:

```js
import sanitizeHtml from 'sanitize-html';
const clean = sanitizeHtml(html, { allowedTags: ['b', 'i', 'em', 'strong', 'a', 'p', 'ul', 'ol', 'li', 'br'], allowedAttributes: { a: ['href'] } });
```

`may_break`: tags and attributes outside the allowed list (scripts, inline event handlers, iframes, `style`) are removed, so formatting that relied on them disappears.

### Markdown

```jsx
import ReactMarkdown from 'react-markdown'; // escapes raw HTML by default; don't add rehype-raw for user content
<ReactMarkdown>{message.text}</ReactMarkdown>
```

With `marked` or `markdown-it`: `DOMPurify.sanitize(marked.parse(text))`, or `markdownIt({ html: false })`. If you must keep `rehype-raw`, add `rehype-sanitize` after it.

### Links from user data

```js
function safeUrl(value) {
  try {
    const url = new URL(value, 'https://placeholder.invalid');
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : '#';
  } catch {
    return '#';
  }
}
<a href={safeUrl(user.website)} rel="noopener noreferrer nofollow">Website</a>
```

### Server templates

- Jinja / Flask: remove `|safe` and `Markup(...)` on user data; keep autoescape on (don't use `{% autoescape false %}`). For rich text, `bleach.clean(html, tags=[...])` or `nh3.clean(html)` before `Markup`.
- Django: remove `|safe` and `mark_safe(...)` on user data.
- Handlebars / Mustache: `{{ value }}` instead of `{{{ value }}}`. EJS: `<%= value %>` instead of `<%- value %>`. Pug: `#{value}` instead of `!{value}`.
- HTML built as a string in a route: escape every value (an escape that encodes `& < > " '`, such as `html.escape(value, quote=True)` in Python), or render a template instead.

## Check 3: `inj.eval`

The rule: data is parsed, never run.

```js
const value = JSON.parse(body.config);          // instead of eval(body.config)
```

```python
import json, yaml, ast
value = json.loads(raw)                          # instead of eval(raw)
value = ast.literal_eval(raw)                    # Python literals only (numbers, strings, lists, dicts)
config = yaml.safe_load(raw)                     # instead of yaml.load(raw)
data = json.loads(upload.read())                 # instead of pickle.loads(upload.read()); never unpickle uploads
render_template("page.html", name=name)          # instead of render_template_string(f"... {name} ...")
```

### Formulas or expressions

Use a math-only evaluator such as `expr-eval` or `mathjs` with a restricted scope (`import { Parser } from 'expr-eval'; new Parser().evaluate(formula, { x })`), or Python `simpleeval`. `vm`, `vm2` and `new Function` are not sandboxes. `fix_risk` is `high`: formulas that used JavaScript features stop working.

### Shell commands

```js
import { execFile } from 'node:child_process';
// Before: exec(`convert ${req.body.file} out.png`)
execFile('convert', [inputPath, 'out.png'], (err) => { /* ... */ });  // no shell; arguments can't add commands
```

```python
subprocess.run(["convert", input_path, "out.png"], check=True)  # list of arguments, no shell=True
```

Also check that a file path from the request stays inside the expected folder, and add `--` before visitor-supplied arguments when the tool supports it, so a value starting with `-` isn't read as an option.

## Check 4: `inj.ssrf`

The rule: parse the URL and allow only exact hostnames you chose.

```js
const ALLOWED_HOSTS = new Set(['images.example-cdn.com', 'api.example-partner.com']);

function checkedUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) return null;
  return url;
}

const url = checkedUrl(body.url);
if (!url) return Response.json({ error: 'URL not allowed' }, { status: 400 });
const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
```

```python
from urllib.parse import urlparse
ALLOWED_HOSTS = {"images.example-cdn.com"}
parsed = urlparse(raw)
if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS:
    abort(400)
resp = requests.get(raw, timeout=5, allow_redirects=False)
```

`redirect: 'error'` / `allow_redirects=False` stops an allowed host from bouncing the request somewhere else. When the feature must fetch any public site (link previews, "import from URL"), an allowlist doesn't fit: resolve the hostname, refuse private, loopback, link-local (`169.254.0.0/16`) and other internal addresses, connect to the address you checked, and follow redirects only through the same check. Use a maintained library for this (for Node, `request-filtering-agent` with `http`/`https`; for Python, `advocate`) rather than hand-written string checks. `may_break`: URLs on hosts not in the list, or on private addresses, now get a 400.
