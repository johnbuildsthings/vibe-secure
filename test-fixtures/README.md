# Test fixtures

Deliberately vulnerable sample apps (plus one correct one) that every audit skill is evaluated against. All keys are fake but pattern-valid. Nothing is installed; run `npm install` yourself only if you need to. Each fixture has `expected-findings.json` and a `smoke.mjs` that exits 0 while the app's features are intact (used to check that `--fix` runs do not break the app). Supabase is always `http://127.0.0.1:4101`.

`area` is the skill name without `check-`: secrets, database-rules, auth, injection, payments, ai-features, config, dependencies, live.

Format of an expected entry: `check`, `subject` (a substring a reasonable finding's `subject` would contain), `min_severity`, `area`.

## nextjs-supabase-leaky
- `secrets.server-key-in-client`: the service_role JWT is exposed as `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` in `.env` and used in `lib/supabase.js` (browser). Subject: `service_role` / `SUPABASE_SERVICE_ROLE_KEY`.
- `secrets.key-in-git-history`: `history.sh` commits `.env.local` with a distinct fake `sk_live_HIST…` key (present nowhere else in the fixture), then deletes and gitignores it. Subject: the masked key, starting `sk_live`.
- `db.rls-disabled`: `supabase/migrations/001_profiles.sql` runs `disable row level security` on `profiles`. Subject: table `profiles`.
- `pay.webhook-unverified`: `app/api/stripe/webhook/route.js` trusts the JSON body with no signature check. Subject: route `/api/stripe/webhook`.
- `pay.client-price`: `app/api/checkout/route.js` takes `price` and `quantity` from the request body. Subject: route `/api/checkout`.
- `inj.xss-html`: `app/components/ProfileCard.jsx` renders `profile.bio` with `dangerouslySetInnerHTML`. Subject: `dangerouslySetInnerHTML`.
- `deps.known-vuln`: `package.json` pins `lodash@4.17.15` (known advisories). Subject: `lodash`.
- `cfg.missing-headers`: `next.config.js` sets no security headers. Subject: `next.config`.
- Live (`expected-live.json`, run against `live-mock`): `db.rls-disabled` on `profiles`, and `live.exposed-file` for `/.env`.

## react-firebase-open
- `db.firestore-open-rules`: `firestore.rules` has `allow read, write: if true`. Subject: `firestore.rules`.
- `auth.ui-only-admin`: `src/App.jsx` hides the `/admin` screen in the UI only; the rules enforce nothing. Subject: `/admin`.
- `auth.client-trusted-identity`: `Profile` in `src/App.jsx` writes the user's own doc (including `role`) from the client, and the app trusts `role` for admin. Subject: `role`.

## next-openai-chatbot
- `secrets.server-key-in-client`: `NEXT_PUBLIC_OPENAI_API_KEY` in `.env.local`. Subject: that env var name.
- `ai.client-side-llm-call`: `components/Chat.jsx` calls OpenAI from the browser with `dangerouslyAllowBrowser`. Subject: `openai`.
- `ai.prompt-to-tool`: `app/api/agent/route.js` runs model-chosen arguments of the `run_sql` tool. Subject: `run_sql`.
- `ai.no-usage-cap`: `/api/agent` has no auth, rate limit or token cap. Subject: `/api/agent`.
- `inj.sql-string`: the `run_sql` handler builds `SELECT ... WHERE ${where}` by string. Subject: `run_sql`.

## secure-baseline
- No findings expected (`baseline: true`). Safe bait: `Bio.jsx` uses `dangerouslySetInnerHTML` but only with `escapeHtml(text)`; the webhook grants a plan from the server catalog, only when paid. `deps.known-vuln` is ignored because advisories change daily.
- False-positive bait that must NOT be flagged: the public anon key in `lib/supabase-public.js` and the Firebase web config in `lib/firebase-config.js`. `.env.example` holds only blank placeholders.

## python-flask-generic
- `inj.sql-string`: `app.py` `search()` builds its query with an f-string. Subject: the function name `search`.
- `secrets.hardcoded-key`: `app.config["SECRET_KEY"]` is a literal in `app.py`. Subject: `SECRET_KEY`.
- `cfg.debug-in-prod`: `app.run(..., debug=True)`. Subject: `debug=True`.
- Unrecognised stack: detect-stack reports framework `unknown`, language `python`.

## live-mock
`node test-fixtures/live-mock/server.mjs --app-port 4100 --db-port 4101 --violations <file> [--fixture <name>]`. Port 0 picks a free port; the ready line `{"app":N,"db":N}` is printed to stdout. Serves `/` (no security headers), `/.env`, `/_next/static/chunks/main.js.map`, `/api/users`, and PostgREST `GET /rest/v1/profiles?…&limit=1` for the fixture's anon key, with `Content-Range: 0-0/1204` only when `Prefer: count=exact` is sent and `0-0/*` otherwise (anon key read from the fixture's `.env`). Non-GET/HEAD requests and `/rest/v1/` requests without `limit=1` are logged to the violations file and answered 405.
