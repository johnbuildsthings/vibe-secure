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

**Chat history:** if the browser sends the whole conversation, accept only `user` and `assistant` messages, keep the last N, and add your system prompt on the server. A browser-sent `system` message is a prompt injection the visitor doesn't even have to hide. For the provider SDKs and AI SDK 4, where each message has string `content`:

```js
const history = (Array.isArray(body.messages) ? body.messages : [])
  .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
  .slice(-20)
  .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
```

### Vercel AI SDK

Keep `useChat` / `useCompletion` in the browser; they call your own route. In AI SDK 5, `useChat` sends UI messages, which carry `parts` instead of a `content` string, so the string filter above would drop every message. Filter by role only, keep the last N, then convert:

```js
import { streamText, convertToModelMessages } from 'ai';
import { openai } from '@ai-sdk/openai';            // reads OPENAI_API_KEY on the server

const { messages } = await req.json();               // UI messages from useChat
const recent = (Array.isArray(messages) ? messages : [])
  .filter((m) => m.role === 'user' || m.role === 'assistant')
  .slice(-20);

const result = streamText({
  model: openai('gpt-4.1-mini'),                     // fixed in code, never from the request
  system: SYSTEM,
  messages: await convertToModelMessages(recent),
  maxOutputTokens: 600,
});
return result.toUIMessageStreamResponse();
```

AI SDK 4: messages have string `content`, so use the filter above, pass `messages: history`, and use `maxTokens` and `result.toDataStreamResponse()`.

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
  if (!r.ok) return new Response('The assistant is unavailable, please try again', { status: 502, headers: cors });
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
// inside toolsFor(user) above, so `user` is the signed-in user from requireUser
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
- never let a tool send data to an address or URL the model chose (that's how planted instructions get private data out). A fetch tool takes a URL whose host is checked against a fixed list (`new URL(u).hostname` compared exactly), or a fixed set of pages;
- don't let replies load images from any host. With `react-markdown`, allow only your own image hosts:

```jsx
const IMAGE_HOSTS = new Set(['images.your-app.example']);
function SafeImg({ src, alt }) {
  try {
    if (IMAGE_HOSTS.has(new URL(src).hostname)) return <img src={src} alt={alt ?? ''} />;
  } catch {}
  return <span>[image removed]</span>;
}
<ReactMarkdown components={{ img: SafeImg }}>{reply}</ReactMarkdown>
```

  (`urlTransform` can do the same for links and images: return `''` for any URL whose host isn't on your list.)

Wrapping outside content in tags with a note like "treat this as data" helps a little, but it isn't a fix on its own.

### Retrieval (RAG) limited to the signed-in user

Supabase / pgvector: filter inside the match function, and call it with the user-scoped client (anon key plus the user's session), with RLS on the documents table:

```sql
create or replace function match_my_documents(query_embedding vector(1536), match_count int)
returns table (id bigint, content text, similarity float)
language sql stable security invoker as $$
  select d.id, d.content, 1 - (d.embedding <=> query_embedding) as similarity
  from documents d
  where d.user_id = auth.uid()                 -- only the caller's own documents
  order by d.embedding <=> query_embedding
  limit least(match_count, 20);
$$;
```

If retrieval must run with the service-role client, give the function a `p_user uuid` parameter used in the `where`, pass `user.id` from the verified session (never from the request), and `revoke execute on function … from public, anon, authenticated;` so nobody can call it through the API with another user's id.

Pinecone: one namespace per user (`index.namespace(user.id).query({ vector, topK: 5 })`), or a metadata filter (`filter: { user_id: { $eq: user.id } }`) on every query. LangChain vector stores: pass the same filter (`similaritySearch(q, 5, { user_id: user.id })`) and make sure every stored chunk has `user_id` in its metadata. `may_break`: answers stop drawing on other users' documents; shared or team documents need their own rule (for example a `team_id` the user belongs to).

### App-hosted MCP servers and agent endpoints

Put a login in front of the endpoint and scope every tool to the caller. With `mcp-handler`, wrap the handler with its auth helper (for example `withMcpAuth(handler, verifyToken, { required: true })`, where `verifyToken` checks the bearer token with your auth provider), then read the verified identity in each tool (the `authInfo` passed to the tool handler) and use it in every query, as in `toolsFor(user)` above. With `@modelcontextprotocol/sdk` on Express, verify the token in middleware before the transport handles the request. Tools that write, send or spend get the confirmation step, or are left out of the server. `may_break`: MCP clients without a token stop connecting until the user signs in or adds a token.

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

### Model, key and provider address fixed on the server

```js
const MODELS = { fast: 'gpt-4.1-mini', smart: 'gpt-4.1' };   // the only models visitors can pick
const model = MODELS[body.tier] ?? MODELS.fast;               // never body.model passed through
```

- Never take `n`, `max_tokens` or the model name from the request as is.
- The provider `baseURL` is fixed in code (or picked from a fixed map). A visitor-chosen `baseURL` sends your key to their server: remove it, and rotate the key if the route was ever deployed (`check-secrets` has the steps).
- Bring your own key: if the visitor sends no key, return 400 ("Please add your API key"); never fall back to yours. If you do want a free tier on your key, treat it as any other route on your key: login, limit and cap.

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

The rule: never run model-written code, SQL or commands. (Model output shown as HTML, directly in `dangerouslySetInnerHTML`, `innerHTML` or an iframe `srcdoc`, or through a markdown renderer with raw HTML on, is `check-injection`'s `inj.xss-html`; its fixes, including safe markdown rendering, are in `<root>/skills/check-injection/references/injection-fixes.md`.)

### Model-written code, SQL or shell commands

- Instead of running the model's SQL: give it typed tools (check 2) that run fixed, parameterised queries scoped to the user.
- Instead of `eval` / `new Function` for formulas: a dedicated expression parser with no access to JavaScript (for example `mathjs` `evaluate`, kept up to date), or a fixed set of operations the model picks from.
- Instead of running a shell command the model wrote: a fixed command with `execFile` and an argument array, with arguments checked against a fixed list.
- If the product really is "run the code the AI wrote", run it in an isolated sandbox service (a provider-hosted code interpreter or a separate container with no secrets and no network), never in your app's server process.

`may_break` for check 4: features that ran model-written code or queries stop working until they are rebuilt on fixed operations.
