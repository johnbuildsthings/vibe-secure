# Auth fixes

Ready-to-adapt patterns for `check-auth` fixes. Replace route, table, collection and field names with the real ones. Use the pattern for the stack the app already uses; never add a second auth library.

## Check 1: add a verified session check

The rule everywhere: find out who is calling on the server, with a call that verifies the token, and stop before touching any data when nobody is signed in.

### Next.js route handler with Supabase (`@supabase/ssr`)

```ts
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
    },
  });
}
```

```ts
// app/api/notes/route.ts
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser(); // verifies the token; getSession() does not
  if (!user) return Response.json({ error: 'Sign in first' }, { status: 401 });
  const { data } = await supabase.from('notes').select('*').eq('user_id', user.id);
  return Response.json(data);
}
```

Replacing `getSession()`: swap `const { data: { session } } = await supabase.auth.getSession()` for `const { data: { user } } = await supabase.auth.getUser()` and use `user.id` instead of `session.user.id`.

Bearer token from a non-browser client (mobile app, script):

```ts
const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
const { data, error } = await admin.auth.getUser(token);
if (!token || error) return Response.json({ error: 'Sign in first' }, { status: 401 });
const user = data.user;
```

### Server actions

Every exported server action is a public endpoint. Check inside the action, not only in the page that shows the form:

```ts
'use server';
import { createClient } from '@/lib/supabase/server';

export async function deleteNote(noteId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in first');
  await supabase.from('notes').delete().eq('id', noteId).eq('user_id', user.id);
}
```

### Auth.js / NextAuth

```ts
import { auth } from '@/auth'; // v5
export async function GET() {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Sign in first' }, { status: 401 });
  // use session.user.id
}
```

v4: `const session = await getServerSession(authOptions)` with the same check.

### Clerk

```ts
import { auth } from '@clerk/nextjs/server';
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: 'Sign in first' }, { status: 401 });
}
```

### Firebase (Cloud Functions or a server route)

```ts
import { getAuth } from 'firebase-admin/auth';

// onRequest or any server route: the browser sends await user.getIdToken() as a Bearer token
const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
let uid;
try { uid = (await getAuth().verifyIdToken(token)).uid; } catch { return res.status(401).json({ error: 'Sign in first' }); }

// onCall
export const doThing = onCall((request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first');
  const uid = request.auth.uid;
});
```

### Supabase Edge Function

The default JWT check accepts the public anon key, so ask Supabase who the token belongs to:

```ts
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
  global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
});
const { data: { user } } = await supabase.auth.getUser();
if (!user) return new Response('Sign in first', { status: 401 });
```

### Express / Flask / FastAPI

```js
// Express: one middleware, applied to every private router
async function requireUser(req, res, next) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  try { req.user = await verify(token); next(); } catch { res.status(401).json({ error: 'Sign in first' }); }
}
app.use('/api/account', requireUser, accountRouter);
```

```python
# Flask-Login
@app.route("/api/account")
@login_required
def account():
    return jsonify(current_user.to_dict())

# FastAPI
@app.get("/api/account")
def account(user = Depends(get_current_user)):  # get_current_user must verify the token
    ...
```

### Next.js middleware that protects pages and API routes

Middleware is a convenience, not a replacement for checks inside route handlers and server actions. If you use it, make the matcher cover the API paths too and verify the session, not just the cookie:

```ts
// middleware.ts
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => req.cookies.getAll(), setAll: (l) => l.forEach(({ name, value, options }) => res.cookies.set(name, value, options)) },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    if (req.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return res;
}

export const config = { matcher: ['/dashboard/:path*', '/api/account/:path*'] };
```

## Check 2: take identity from the session, and roles from a place users can't write

### Server code

Delete the field from what the route reads, and use the verified user instead:

```ts
// before: const { userId, title } = await req.json();
const { title } = await req.json();
await db.note.create({ data: { title, userId: user.id } }); // user from getUser()/auth()
```

For a role, look it up on the server from a source users can't change, never from the request.

### Firebase: custom claims

Set the role with the Admin SDK (from a one-off script or an admin-only function), and check it in rules and in the browser:

```js
// scripts/make-admin.mjs (run once by you, with a service account)
import { getAuth } from 'firebase-admin/auth';
await getAuth().setCustomUserClaims('<uid>', { admin: true });
```

```
// firestore.rules
function isAdmin() { return request.auth != null && request.auth.token.admin == true; }
match /accounts/{uid} {
  allow read: if request.auth.uid == uid || isAdmin();
  allow update: if request.auth.uid == uid
    && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['role', 'isAdmin', 'plan']);
  allow delete: if isAdmin();
}
```

```js
// browser: show the admin screen from the claim, after a token refresh
const { claims } = await auth.currentUser.getIdTokenResult(true);
const isAdmin = claims.admin === true;
```

Also remove the privilege field from any form object the browser saves. `manual_steps`: "Run the make-admin script once for each person who should be an admin; they must sign out and in again."

### Supabase: `app_metadata` or a protected column

`app_metadata` can only be set with the service role key, so users can't change it:

```ts
// server-only script or admin route
await admin.auth.admin.updateUserById('<user id>', { app_metadata: { role: 'admin' } });
```

```sql
-- policy that lets admins read everything
create policy "admins read all" on public.notes for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
```

If the role must stay in a table column, stop users updating it (`check-database-rules`' cookbook has the column-grant and trigger versions):

```sql
revoke update on public.accounts from authenticated;
grant update (display_name, avatar_url) on public.accounts to authenticated;
```

## Check 3: protect the admin area on the server

Every read and action the admin screen uses must check the role on the server; the UI check stays only for looks.

```ts
// lib/require-admin.ts
export async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== 'admin') throw new Response('Forbidden', { status: 403 });
  return user;
}
```

Call it at the top of every admin route handler, server action and admin server page. For a browser-only Firebase app, the admin rules above (`isAdmin()` on the collections the admin screen reads and deletes) are the server check. For Supabase, the admin policy above.

## Check 4: rate-limit your own login and code checks

Upstash (works on Vercel and other serverless hosts):

```ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const limiter = new Ratelimit({ redis: Redis.fromEnv(), limiter: Ratelimit.slidingWindow(5, '10 m') });

export async function POST(req: Request) {
  const { email, password } = await req.json();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  const { success } = await limiter.limit(`login:${ip}:${String(email).toLowerCase()}`);
  if (!success) return Response.json({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429 });
  // ... check the password
}
```

Express: `app.post('/api/login', rateLimit({ windowMs: 10 * 60 * 1000, limit: 5 }), loginHandler)` with `express-rate-limit`. Flask: `@limiter.limit("5 per 10 minutes")` with Flask-Limiter.

`manual_steps` for Upstash: "Create a free Redis database at console.upstash.com, then add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to your host's environment variables." `may_break`: "Someone who mistypes their password more than 5 times in 10 minutes has to wait."

Also return the same error for "no such user" and "wrong password", so attackers can't learn which emails have accounts.

## Check 5: safe session storage

Cookie options:

```ts
cookies().set('session', token, {
  httpOnly: true,                                  // page scripts can't read it
  secure: process.env.NODE_ENV === 'production',   // only sent over https in production
  sameSite: 'lax',                                 // not sent on cross-site form posts
  path: '/',
  maxAge: 60 * 60 * 24 * 7,
});
```

Express: `res.cookie('session', token, { httpOnly: true, secure: true, sameSite: 'lax' })`. Flask: `SESSION_COOKIE_HTTPONLY = True`, `SESSION_COOKIE_SECURE = True`, `SESSION_COOKIE_SAMESITE = "Lax"`. Django: `SESSION_COOKIE_SECURE = True`, `CSRF_COOKIE_SECURE = True`.

`may_break` for `secure`: "Login won't stick if you test on plain http on a host other than localhost."

Tokens in `localStorage`: have the login route set the token as an `httpOnly` cookie (above) instead of returning it to the page, send requests with `credentials: 'include'`, and read the cookie on the server. Remove every `localStorage.setItem('<key>', token)` and `getItem` use. This is `fix_risk: high`: `may_break` names every place that reads the token from storage (`Authorization` headers built in the browser), which must switch to the cookie in the same change.
