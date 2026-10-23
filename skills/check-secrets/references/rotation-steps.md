# Rotating leaked keys

Use these steps for `manual_steps` whenever a key was leaked: shipped to the browser, committed to git, or found in git history. Copy the steps for the right provider and name the **masked** key (`sk_live_4f…a9`) in the first step so the user rotates the right one. Never include the full key.

Dashboard labels change from time to time. If a label doesn't match, tell the user what to look for ("the page that lists your API keys") rather than inventing a path.

Every rotation ends the same way:

1. Put the new key where the app runs: your host's environment variables (Vercel: Project → Settings → Environment Variables; Netlify: Site configuration → Environment variables; Supabase Edge Functions: Project → Edge Functions → Secrets) and your local `.env.local`. Use a **server-only** name, with no `NEXT_PUBLIC_`/`VITE_`/`REACT_APP_` prefix.
2. Redeploy so the new value is used.
3. Check the provider's usage or logs for activity you don't recognise since the key leaked.
4. Tell Claude you've rotated it. Until then, the finding stays "waiting for you".

## Supabase service role key

**If the project uses the new API keys** (keys starting `sb_secret_` / `sb_publishable_`):

1. Open supabase.com/dashboard → your project → Project Settings → API Keys.
2. Under "Secret keys", click "Add new secret key", name it, and copy it.
3. Put it in `SUPABASE_SERVICE_ROLE_KEY` (or whatever server-only name your code reads) on your host and in `.env.local`, then redeploy.
4. Back in API Keys, delete the leaked secret key (`sb_secret_…` with the masked ending shown in the finding).

**If the leaked key is the legacy `service_role` JWT** (starts with `eyJ`): a legacy JWT can't be revoked on its own. Either:

- **Recommended:** create a new secret key as above, switch your server code to it, then in Project Settings → API Keys → "Legacy API keys" click "Disable legacy API keys". This also disables the legacy anon key, so switch the browser to the new publishable key (`sb_publishable_…`) first.
- **Or** rotate the JWT secret: Project Settings → JWT Keys (older dashboards: API → JWT Settings) → "Generate a new secret" / rotate. This replaces **both** the anon and service_role keys and signs every user out. Copy the new anon key into your browser config and the new service_role key into your server-only variable, then redeploy.

**Database password** (from a leaked `postgres://…` URL): Project Settings → Database → "Reset database password". Update every connection string that uses it.

## Stripe

1. Open dashboard.stripe.com. For a `sk_live_`/`rk_live_` key, make sure **Test mode is off**. For `sk_test_`/`rk_test_`, turn it on.
2. Go to Developers → API keys.
3. Secret key: next to the key with the masked ending from the finding, click ⋯ → "Roll key…", set the old key to expire **now**, and confirm. Copy the new key from the dialog, because it's shown only once.
   Restricted key (`rk_`): find it under "Restricted keys", click ⋯ → "Roll key…" (or delete it and create a new one with the same permissions).
4. Webhook signing secret (`whsec_`): Developers → Webhooks → your endpoint → "Signing secret" → "Roll secret", and set it to expire now. Update `STRIPE_WEBHOOK_SECRET`.
5. Then the common steps: host env vars, redeploy, and check Developers → Logs and Payments → Refunds for anything you didn't do.

## OpenAI

1. Open platform.openai.com → Settings (gear icon) → API keys. For a project key (`sk-proj-`), pick the project from the top left first.
2. Find the key whose visible ending matches the finding. Click the trash icon → "Revoke key".
3. Click "Create new secret key", give it the same project and permissions, and copy it (it's shown once).
4. Common steps. Check Usage for unexpected spend, and consider setting a monthly budget under Settings → Limits.

## Anthropic

1. Open console.anthropic.com → Settings → API keys.
2. Find the leaked key by its name and visible ending. Click ⋯ → "Delete API key" (or "Disable").
3. Click "Create Key", choose the workspace, and copy it (it's shown once).
4. Common steps. Check Usage and Cost for unexpected spend, and set a spend limit under Limits.

## Google AI (Gemini) keys

1. Open aistudio.google.com → "Get API key", find the key with the leaked ending, and delete it. Or open console.cloud.google.com → APIs & Services → Credentials, select the key, and click "Regenerate key" (or delete it).
2. Create a new key ("Create API key" in AI Studio, or "+ Create credentials" → API key in Cloud Console).
3. In Cloud Console → Credentials → the new key → "API restrictions", restrict it to "Generative Language API".
4. Common steps. Check Billing → Reports for unexpected spend.

(If the leaked `AIza…` key is really a Firebase web key or a Maps browser key, it isn't secret. Instead of rotating, restrict it: Credentials → key → "Application restrictions" → websites → your domain.)

## AWS access keys

1. Open console.aws.amazon.com → IAM → Users → the user that owns the key (search by the access key id's visible start, `AKIA…`) → "Security credentials".
2. Under "Access keys", click "Create access key", and copy the access key id and secret (the secret is shown once).
3. Put both in your server-only variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) on your host and in `.env.local`, then redeploy.
4. Back on the old key: Actions → "Deactivate", confirm the app still works, then Actions → "Delete".
5. Check CloudTrail → Event history and Billing for activity you don't recognise. If you find any, contact AWS Support.

## Other secrets

- **Session or signing secrets** (`SECRET_KEY`, `NEXTAUTH_SECRET`, `AUTH_SECRET`, `JWT_SECRET`): generate a new random value with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` or `python3 -c "import secrets; print(secrets.token_hex(32))"`, put it in the server-only variable on your host and in `.env.local`, then redeploy. Everyone gets signed out once.
- **Any other provider** (Resend, SendGrid, GitHub, Slack, Twilio): open that provider's API keys or tokens page, revoke the key with the masked ending, create a new one, then do the common steps.

## Optional: purge the key from git history

This comes **after** rotation and is never a substitute for it: anyone who already copied the repository, its forks, or a CI cache still has the old key. Only rotation makes it useless. Purging is worth doing mainly if the repository is public or shared widely.

1. Make a backup: copy the whole project folder somewhere safe.
2. Install git-filter-repo: `brew install git-filter-repo` (Mac) or `pip install git-filter-repo`.
3. Remove the leaked file from every commit:
   `git filter-repo --invert-paths --path <file>` (for example `--path .env.local`).
   If the key was inside a file you want to keep, remove just the key instead. Create a file `replacements.txt` containing one line, `<the old key>==>REMOVED` (type the key yourself; don't paste it into chat), then run `git filter-repo --replace-text replacements.txt` and delete `replacements.txt`.
4. git-filter-repo removes your `origin` remote as a safety measure. Add it back with `git remote add origin <your repo URL>`, then run `git push --force --all` and `git push --force --tags`.
5. Ask everyone who cloned the repository to delete their copy and clone it again.
6. On GitHub, old commits can stay reachable through pull requests and forks. If the repository is public, contact GitHub Support and ask them to remove cached views of the commit.
