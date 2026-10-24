# Config fixes: CORS, debug, error replies, logs, source maps

Illustrative names (`app.example.com`, `/api/account`). Replace them with the app's own.

## `cfg.cors-wildcard-credentials`: allow only your own sites

Ask the user (or read the frontend's deploy config) for the exact addresses that call the API: `https://app.example.com`, `http://localhost:3000` for development. Full origins only: scheme + host + port, no wildcards.

**Next.js route handler or middleware:**

```js
const ALLOWED_ORIGINS = new Set([
  'https://app.example.com',
  ...(process.env.NODE_ENV === 'development' ? ['http://localhost:3000'] : []),
]);

function corsHeaders(req) {
  const origin = req.headers.get('origin');
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
}

export async function OPTIONS(req) {
  return new Response(null, { status: 204, headers: { ...corsHeaders(req), 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
```

Add `...corsHeaders(req)` to every response's headers. If the frontend and API are on the same domain, delete the CORS headers instead: same-site calls don't need them.

**Express (`cors` package):**

```js
import cors from 'cors';
app.use(cors({ origin: ['https://app.example.com'], credentials: true }));
```

**Flask-CORS:**

```python
CORS(app, origins=["https://app.example.com"], supports_credentials=True)
```

**FastAPI:**

```python
app.add_middleware(CORSMiddleware, allow_origins=["https://app.example.com"], allow_credentials=True, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
```

**Django (`django-cors-headers`):**

```python
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = ["https://app.example.com"]
CORS_ALLOW_CREDENTIALS = True
```

**Host config (`vercel.json`, `netlify.toml`, `_headers`):** a fixed header can't check the origin. Remove `Access-Control-Allow-Credentials` there, or remove the CORS headers and set them in code as above.

If the API doesn't need cookies from other sites at all, the simplest fix is to drop the credentials setting and keep `*`.

## `cfg.debug-in-prod`: debug settings

**Flask:**

```python
import os

if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1")
```

Drop `host="0.0.0.0"` unless the app must be reachable from other machines, and then never with debug on. For production, run it with a real server (`gunicorn app:app`), which never starts the debugger. `manual_steps`: "Don't set FLASK_DEBUG on your host."

**Django (`settings.py`):**

```python
import os
DEBUG = os.environ.get("DJANGO_DEBUG") == "1"
ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "").split(",")
```

`may_break`: with `DEBUG` off, Django refuses requests whose host isn't in `ALLOWED_HOSTS` and stops serving static files itself (use WhiteNoise or the host's static setting). `manual_steps`: set `DJANGO_ALLOWED_HOSTS` on the host.

**FastAPI / Starlette:** `FastAPI(debug=os.environ.get("APP_DEBUG") == "1")`; remove `--reload` from the production start command.

**Inverted checks:** compare against the value that means "development", so a missing variable means production: `const showDetails = process.env.NODE_ENV === 'development';`.

**Debug consoles and admin UIs** (Prisma Studio, Adminer, phpMyAdmin, a `/debug` route): remove them from the deployed app, or put them behind the app's admin login (see `check-auth`). `manual_steps` if a public one already ran: change the database password.

## `cfg.debug-in-prod`: error details sent to visitors

Log the details on the server, send a short message to the visitor.

**Next.js route handler:**

```js
export async function POST(req) {
  try {
    // ...the route's work...
  } catch (err) {
    console.error('POST /api/account failed', err);
    return Response.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
```

For Supabase calls, replace `return Response.json({ error: error.message })` with a log line and a fixed message. Keep messages your own code wrote for the visitor ("Email is required") and Stripe card errors (`err.type === 'card_error'`).

**Express error middleware (after all routes):**

```js
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status && err.status < 500 ? err.status : 500).json({ error: err.status && err.status < 500 ? err.message : 'Something went wrong' });
});
```

Only use `err.message` for errors your code created on purpose with a 4xx status.

**Flask:**

```python
from werkzeug.exceptions import HTTPException

@app.errorhandler(Exception)
def handle_error(e):
    if isinstance(e, HTTPException):
        return e
    app.logger.exception("Unhandled error")
    return {"error": "Something went wrong"}, 500
```

**Supabase Edge Function:** `catch (err) { console.error(err); return new Response(JSON.stringify({ error: 'Something went wrong' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }`

`may_break`: if browser code shows `data.error` to the user, it now shows the generic text; name that file and line.

## `cfg.debug-in-prod`: secrets in logs

Log what you need to debug, never what lets someone sign in:

```js
console.log('login attempt', { email: body.email });                       // not the password or the whole body
console.log('request', { method: req.method, url: req.url });              // not req.headers
```

Python: `app.logger.info("login attempt for %s", email)`, never `request.headers` or `request.get_data()`.

If a logging library is used, configure redaction: pino `redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token']`.

`manual_steps`: "Delete or restrict access to old logs on your host that contain tokens or passwords", and, if a long-lived key or webhook secret was printed, "Rotate it" (`check-secrets` has the steps).

## `cfg.public-source-maps`

- **Next.js:** remove `productionBrowserSourceMaps: true` (or set it to `false`).
- **Vite:** `build: { sourcemap: 'hidden' }` (maps are built for an error tracker but not linked), or `false`.
- **webpack:** `devtool: 'hidden-source-map'` or `false` for production.
- **Create React App:** `"build": "GENERATE_SOURCEMAP=false react-scripts build"` in `package.json` (on Windows, put `GENERATE_SOURCEMAP=false` in `.env.production` instead).
- **Using Sentry:** keep maps hidden and let its build plugin upload and delete them (`sourcemaps: { filesToDeleteAfterUpload: ['dist/**/*.map'] }` for the Vite plugin; `@sentry/nextjs` hides them by default).
