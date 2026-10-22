# Severity guide

Every finding gets exactly one severity. Pick it with the definitions below (verbatim from the design spec, §3), then use the check's own severity rule in its `SKILL.md`. When the two disagree, the check's rule wins, because it was written for that exact case.

Rank: critical > high > medium > low > unverified.

## Definitions

- **Critical:** strangers can steal data, money or accounts right now with no skill required.
- **High:** an attacker with moderate skill could do serious damage.
- **Medium:** it makes other attacks easier or leaks something minor.
- **Low:** hardening and best practice.
- **Unverified:** a suspicion you couldn't prove. It needs no evidence, gets no severity color, and appears only in the report's "worth a look" list. Use it instead of guessing a higher level.

## How to decide

1. **No proof, no finding.** If you can't point at a `file:line` or a live request and response, it is `unverified`.
2. Ask "who can do this, and how hard is it?" Anyone with a browser and no skill → critical. Someone who has to read your code, sign up, or chain two steps → high. Only helps another attack → medium. Nobody can exploit it today → low.
3. Don't raise a severity because the code looks messy, and don't lower it because a value "looks fake" or the app "is small". Judge only the consequence.
4. If a fix exists and the issue is real but you are unsure between two levels, choose the lower one and say why in `impact`.

## One example per level, per area

| Area | Critical | High | Medium | Low |
|---|---|---|---|---|
| secrets | Your Supabase `service_role` key ships in the browser bundle through a `NEXT_PUBLIC_` variable | A live Stripe key was committed to git and later deleted, so it is still in the history | A secret is hard-coded as a fallback (`process.env.X ?? "dev-secret"`) that only runs locally | A `.env` file holding only public values isn't gitignored |
| database-rules | Row level security is off on `profiles`, and the browser queries it with the anon key | Any logged-in user can read every other user's documents (`if request.auth != null`) | A public-read policy exposes a column you probably didn't mean to show, such as `created_by` | An intentionally public table has no comment explaining why it is open |
| auth | A route that changes user data has no login check at all | The admin page is hidden in the UI only, and its API has no server check | The custom login form has no rate limit, so passwords can be guessed slowly; or session cookies lack `httpOnly`/`secure`/`sameSite` | Signing out only clears the cookie in the browser, and the session stays valid on the server until it expires |
| injection | `eval()` runs text taken straight from the request | A search route builds SQL with an f-string from the query string | A Supabase `.or()` filter string is built from user input | Rendered HTML is escaped by hand instead of with a library |
| payments | The Stripe webhook trusts the request body without checking the signature, so anyone can mark an order paid | The checkout route takes the price from the request, so a buyer can set their own price | The success page shows an order as paid before the webhook confirms it | Webhook events aren't logged, which makes disputes harder to investigate |
| ai-features | User text reaches an AI tool that can run SQL or delete data | The AI endpoint has no login and no rate limit, so anyone can run up your bill | Model output is shown without a length limit, so abusive replies can flood the page | The system prompt isn't versioned or reviewed |
| config | — (config issues on their own rarely let strangers take data) | CORS allows any site to call your API with the user's cookies | Debug mode is on in production and leaks stack traces | Security headers such as `Content-Security-Policy` aren't set |
| dependencies | A package you install is known to run malicious code | A package has a known vulnerability rated high by npm | No lockfile, so every install can pull different versions | A dev-only tool has a low-rated advisory |
| live | Your deployed site serves `/.env` to anyone | Your deployed site serves `/.git/HEAD`, so the source code can be rebuilt | Your production error pages show stack traces | The homepage is missing security headers |

The `live` area mostly confirms code findings and then uses the code check's id and severity. The table shows only its own checks.
