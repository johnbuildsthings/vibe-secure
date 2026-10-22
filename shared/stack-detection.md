# Stack detection

Run `node scripts/detect-stack.mjs <project-root>` first. It writes `.vibe-secure/stack.json` and prints it. Every audit skill reads that file to decide which checks apply.

`stack.json` looks like `{ "root": "...", "apps": [ ... ] }`. An app is one folder with a `package.json`, `pyproject.toml` or `requirements.txt` (up to 3 folders deep; `node_modules`, `.next`, `dist`, `build`, `out`, `.git`, `.vercel`, `.netlify`, `.vibe-secure` and `coverage` are skipped). A monorepo gives one entry per app, sorted by `path`. An empty `apps` list means no app was found.

## Fields

| Field | Values | Meaning |
|---|---|---|
| `path` | relative path, forward slashes; `.` for the root | Where the app lives |
| `language` | `js`, `python`, `other` | `js` if the folder has a `package.json` (even with a Python manifest too); `python` if it only has a Python manifest; `other` is reserved |
| `framework` | `next`, `remix`, `sveltekit`, `react-vite`, `express`, `unknown` | From dependencies. Python apps and unrecognized JS apps are `unknown` |
| `db` | list of `supabase`, `firebase`, `prisma`, `drizzle`, `mongodb` | Database or backend service in use (dependency or config file) |
| `payments` | list: `stripe` | Payment provider |
| `ai` | list of `openai`, `anthropic`, `google`, `vercel-ai` | AI provider SDKs |
| `host` | `vercel`, `netlify`, `firebase`, `unknown` | From `vercel.json`, `.vercel/`, `netlify.toml`, or `firebase.json` with hosting |
| `generator` | `lovable`, `bolt`, `null` | AI app builder that made the project. v0 output cannot be told apart reliably, so it shows as `null` |

A malformed `package.json` still counts as an app, with no dependencies and framework `unknown`.

## How skills use it

- Each area skill has an "Applies when" condition (for example, "an app uses `supabase`"). The skill applies when that condition holds for at least one app, and then runs once per app where it holds.
- General checks (secrets, dependencies, headers) apply to every app, including `unknown` ones.
- If a stack-specific check is skipped because the stack is not recognized, say so plainly in the report. Never skip silently and never fail on an unknown stack.
- Use `host` and `generator` to tailor fix advice (where to set environment variables, which builder to re-prompt).
