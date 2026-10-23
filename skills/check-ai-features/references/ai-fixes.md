# AI feature fixes

Ready-to-adapt patterns for `check-ai-features` fixes. Replace route, tool, table and model names with the real ones. Use the AI SDK, database client and login helper the app already has; never add a second one. Env variable names here (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) are examples: keep the app's own names, but never with a browser prefix (`NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`, `EXPO_PUBLIC_`, `PUBLIC_`). `requireUser` below stands for the app's own verified session check (see "How to tell whether a login is checked" in `<root>/skills/check-auth/SKILL.md`).

## Check 1: `ai.client-side-llm-call`

The rule: the browser talks only to your server, and your server talks to the provider. The server route checks the login, applies the limit and the token cap, and owns the system prompt.

### Next.js App Router, provider SDK

```js
// app/api/assistant/route.js (server only: never import this file from a 'use client' file)
import OpenAI from 'openai';
import { requireUser } from '@/lib/auth';        // your verified session check
import { aiLimit } from '@/lib/ai-limit';        // see check 3

const openai = new OpenAI();                      // reads OPENAI_API_KEY on the server
const SYSTEM = 'You are the help assistant for this app. Answer briefly.';

export async function POST(req) {
  const user = await requireUser(req);
  if (!user) return Response.json({ error: 'Please sign in' }, { status: 401 });
  if (!(await aiLimit(`user:${user.id}`))) return Response.json({ error: 'Please slow down' }, { status: 429 });

  const { prompt } = await req.json();
  if (typeof prompt !== 'string' || prompt.length > 2000) {
    return Response.json({ error: 'Please send a shorter question' }, { status: 400 });
  }
  const completion = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',                          // chosen by the server, never by the browser
    max_completion_tokens: 600,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }],
  });
  return Response.json({ reply: completion.choices[0].message.content });
}
```

Browser side: delete the SDK client and `dangerouslyAllowBrowser`, then call the route, sending the session the way the app already does (cookies are sent automatically for same-site requests; a Supabase or Firebase app adds its access token as `Authorization: Bearer …`):

```js
const res = await fetch('/api/assistant', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: input }),
});
const { reply, error } = await res.json();
```

**Chat history:** if the browser sends the whole conversation, accept only `user` and `assistant` messages with string content, keep the last N, and add your system prompt on the server. A browser-sent `system` message (or a fake `assistant` turn) is a prompt injection the visitor doesn't even have to hide:

```js
const history = (Array.isArray(body.messages) ? body.messages : [])
  .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
  .slice(-20)
  .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
```

### Vercel AI SDK

Keep `useChat` / `useCompletion` in the browser; they call your own route. In the route:

```js
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';            // reads OPENAI_API_KEY on the server

const result = streamText({
  model: openai('gpt-4.1-mini'),
  system: SYSTEM,
  messages,                                          // converted and filtered as above
  maxOutputTokens: 600,                              // AI SDK 4: maxTokens
});
return result.toUIMessageStreamResponse();           // AI SDK 4: toDataStreamResponse()
```

Put the login check and the limit before `streamText`, as in the route above.

### Vite or another single-page app: Supabase Edge Function

There's no server, so the call moves into a function. `supabase/functions/assistant/index.ts`:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': 'https://your-app.example',   // your site's address
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return new Response('Please sign in', { status: 401, headers: cors });
  // limit check here (see check 3)

  const { prompt } = await req.json();
  if (typeof prompt !== 'string' || prompt.length > 2000) return new Response('Too long', { status: 400, headers: cors });
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      max_completion_tokens: 600,
      messages: [{ role: 'system', content: 'You are the help assistant for this app.' }, { role: 'user', content: prompt }],
    }),
  });
  const data = await r.json();
  return Response.json({ reply: data.choices?.[0]?.message?.content ?? '' }, { headers: cors });
});
```

The browser calls it with `supabase.functions.invoke('assistant', { body: { prompt } })`, which sends the user's token. `manual_steps`: "Run `supabase secrets set OPENAI_API_KEY=<your key>`, then `supabase functions deploy assistant`." On Vercel or Netlify without Supabase, the same code goes in `api/assistant.js` or `netlify/functions/assistant.js`, with the app's own login check.

### Flask / FastAPI

```python
from openai import OpenAI
client = OpenAI()  # reads OPENAI_API_KEY

@app.post("/api/assistant")
@login_required                       # or Depends(get_current_user) in FastAPI
@limiter.limit("20/hour", key_func=lambda: str(current_user.id))
def assistant():
    prompt = (request.get_json(silent=True) or {}).get("prompt")
    if not isinstance(prompt, str) or len(prompt) > 2000:
        return {"error": "Please send a shorter question"}, 400
    out = client.chat.completions.create(
        model="gpt-4.1-mini", max_completion_tokens=600,
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}],
    )
    return {"reply": out.choices[0].message.content}
```

`may_break` for check 1: the AI features stop working until the browser uses the new route, and the deployed app needs the key set as a server-only variable on the host. The key that shipped in the browser is already public: `check-secrets` gives its rotation steps.

## Check 2: `ai.prompt-to-tool`

The rules: every tool acts only for the signed-in user, every tool does one fixed thing with checked arguments, and anything that writes, sends or spends waits for the user's confirmation. A system prompt is never the guard.

### Scope to the signed-in user, fixed actions

```js
// Before: a tool that takes an id (or a filter, or SQL) from the model and acts on whatever it names.
// After: the user id comes from the session (closure), the argument is checked in code.
import { tool } from 'ai';
import { z } from 'zod';

function toolsFor(user) {                           // build the tools per request, after requireUser
  return {
    list_my_invoices: tool({
      description: "List the signed-in customer's invoices by status",
      inputSchema: z.object({ status: z.enum(['paid', 'open', 'void']) }),  // AI SDK 4: parameters
      execute: async ({ status }) => {
        if (!['paid', 'open', 'void'].includes(status)) throw new Error('bad status');
        return db.invoice.findMany({
          where: { customerId: user.id, status },     // never an id the model chose
          select: { id: true, amountCents: true, status: true },
        });
      },
    }),
  };
}
```

With the provider SDK (`tools: [{ type: 'function', … }]` or Anthropic `input_schema`), apply the same rule in the code that handles the tool call: parse the arguments, check every value against a fixed list or type, and add `user.id` from the session yourself. A tool that took SQL, a filter string, a shell command or code becomes one or more typed tools like the one above; `check-injection`'s fixes (`references/injection-fixes.md`, "AI tools that run SQL") show the parameterised query.

### Confirm before writes, sends and payments

Don't let the model do it; let it propose it:

```js
propose_refund: tool({
  description: 'Propose a refund of one of the signed-in customer\'s orders. The customer must confirm.',
  inputSchema: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => {
    const order = await db.order.findFirst({ where: { id: orderId, customerId: user.id } });
    if (!order) return { error: 'No such order' };
    const pending = await db.pendingAction.create({ data: { userId: user.id, kind: 'refund', orderId } });
    return { needsConfirmation: true, pendingId: pending.id, amountCents: order.amountCents };
  },
}),
```

The chat shows a Confirm button for `needsConfirmation`. Pressing it calls a separate route that runs `requireUser`, loads the pending action **by id and `userId: user.id`**, checks it hasn't been used, and only then does the refund. The model never reaches that route.

### Outside content (indirect prompt injection)

When the assistant reads web pages, emails, uploaded files or other users' messages:

- give that conversation only read-only tools scoped to the user; or
- require the confirmation step above for every write, send and payment, and show the user exactly what will be done;
- never let a tool send data to an address or URL the model chose (that's how planted instructions get private data out).

Wrapping outside content in tags with a note like "treat this as data" helps a little, but it isn't a fix on its own.

### Tools to remove

Remove "run SQL", "run shell command", "run code" and "fetch any URL" tools from anything a visitor can talk to. If you need code execution, use the provider-hosted sandbox (OpenAI `code_interpreter`), which runs on the provider's machines, not yours. For connected MCP servers, give them a token with the narrowest permissions the feature needs (read-only where possible) and the same confirmation step for writes.

`may_break` for check 2: name the requests the assistant can no longer handle (free-form database questions, acting on orders the user doesn't own, sending without a click), and the UI that needs a Confirm button.

## Check 3: `ai.no-usage-cap`

Three parts: a token cap on every call, a limit per user (or per IP when signed out), and a provider spending limit as the last safety net.

### Token caps per provider

| Library | Setting |
|---|---|
| OpenAI Chat Completions | `max_completion_tokens: 600` (older code: `max_tokens`) |
| OpenAI Responses API | `max_output_tokens: 600` |
| Anthropic | `max_tokens: 600` (required by the API: lower a huge value) |
| Gemini `@google/generative-ai` | `generationConfig: { maxOutputTokens: 600 }` |
| Gemini `@google/genai` | `config: { maxOutputTokens: 600 }` |
| Vercel AI SDK | `maxOutputTokens: 600` (AI SDK 4: `maxTokens`); for tool loops also a step limit (`stopWhen: stepCountIs(5)`, AI SDK 4: `maxSteps: 5`) |
| LangChain | `maxTokens: 600` on the chat model (Python: `max_tokens=600`) |
| Image generation | a fixed `n: 1` and a fixed `size` chosen by the server |

Pick a value that fits the feature (a short answer: 300–800; a long draft: up to a few thousand). Never take it from the request. Also cap the visitor's prompt length before the call (input tokens cost money too).

### Rate limit per user: Upstash (works on serverless hosts)

```js
// lib/ai-limit.js
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),                               // UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
  limiter: Ratelimit.slidingWindow(30, '1 h'),
  prefix: 'ai',
});

export async function aiLimit(key) {
  const { success } = await ratelimit.limit(key);
  return success;
}
```

Call it with `user:${user.id}` for signed-in users. For a route that must stay public, use the visitor's IP (`req.headers.get('x-forwarded-for')?.split(',')[0].trim()` on Vercel and Netlify) and a lower limit. An in-memory `Map` limiter only works on a single long-running server; on serverless hosts replace it with this.

`manual_steps` for Upstash: "Create a free Redis database at console.upstash.com, then add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to your host's environment variables."

### Daily quota in Postgres / Supabase

```sql
create table if not exists ai_usage (
  user_id uuid not null,
  day date not null default current_date,
  calls int not null default 0,
  primary key (user_id, day)
);
alter table ai_usage enable row level security;          -- no policies: only the server touches it

create or replace function bump_ai_usage(p_user uuid, p_limit int) returns boolean
language sql security definer set search_path = public as $$
  insert into ai_usage (user_id, day, calls) values (p_user, current_date, 1)
  on conflict (user_id, day) do update set calls = ai_usage.calls + 1
    where ai_usage.calls < p_limit
  returning true;
$$;
revoke execute on function bump_ai_usage(uuid, int) from public, anon, authenticated;
```

Call it from the server with the service-role client, before the AI call: `const { data } = await admin.rpc('bump_ai_usage', { p_user: user.id, p_limit: 50 })`. `data !== true` means the user is over today's limit (return 429). The `revoke` matters: without it, anyone could call the function through the API and burn other users' quota.

### Python

Flask-Limiter (`@limiter.limit("20/hour")`) or FastAPI `slowapi`, keyed by the user id, with a Redis storage URI (`storage_uri="redis://…"`) when the app runs more than one process.

### Spending limit (manual step, always)

A limit in the provider's dashboard can't be seen from code and doesn't replace the per-user limit, but it caps the worst case. Add to `manual_steps` (menu names change; look for "Limits", "Usage limits" or "Budgets"):

- OpenAI: platform.openai.com → Settings → Limits: set a monthly budget for the project, and turn on usage alerts.
- Anthropic: console.anthropic.com → Settings → Limits: set a monthly spend limit.
- Google AI (Gemini): Google Cloud console → Billing → Budgets & alerts. Budgets there only alert; they don't stop spending.

`may_break` for check 3: very long answers get cut off at the cap, and users who send many requests see "please slow down". A login added to a public route stops signed-out visitors from using the feature.

## Check 4: `ai.output-as-html`

The rule: show model output as text. When it must be formatted, render markdown with raw HTML off, or sanitise right before the sink. Never run model-written code, SQL or commands.

### React

```jsx
// Plain text
<p className="whitespace-pre-wrap">{reply}</p>

// Markdown, safe by default (no rehype-raw)
import ReactMarkdown from 'react-markdown';
<ReactMarkdown>{reply}</ReactMarkdown>

// If raw HTML is really needed, sanitise after rehype-raw
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
<ReactMarkdown rehypePlugins={[rehypeRaw, rehypeSanitize]}>{reply}</ReactMarkdown>
```

### `marked`, `markdown-it`, `showdown`, plain DOM

```js
import DOMPurify from 'dompurify';               // isomorphic-dompurify when it runs on the server
import { marked } from 'marked';
el.innerHTML = DOMPurify.sanitize(marked.parse(reply));
```

For `markdown-it`, keep `html: false` (the default). Vue: `v-html="DOMPurify.sanitize(html)"` or render text with `{{ }}`. Svelte: `{@html DOMPurify.sanitize(html)}` or plain `{reply}`.

### Model-written HTML previews

Show them in an iframe that can't reach your page or your users' login:

```jsx
<iframe sandbox="allow-scripts" srcDoc={generatedHtml} title="Preview" />
```

`allow-scripts` without `allow-same-origin` runs the preview's scripts in an isolated origin. Never add both.

### Model-written code, SQL or shell commands

- Instead of running the model's SQL: give it typed tools (check 2) that run fixed, parameterised queries scoped to the user.
- Instead of `eval` / `new Function` for formulas: a dedicated expression parser with no access to JavaScript (for example `mathjs` `evaluate`, kept up to date), or a fixed set of operations the model picks from.
- Instead of running a shell command the model wrote: a fixed command with `execFile` and an argument array, with arguments checked against a fixed list.
- If the product really is "run the code the AI wrote", run it in an isolated sandbox service (a provider-hosted code interpreter or a separate container with no secrets and no network), never in your app's server process.

`may_break` for check 4: replies lose any raw HTML (tables and links written in markdown still show with `react-markdown`); features that ran model-written code or queries stop working until they are rebuilt on fixed operations.
