# Finding format

Every audit skill writes its results to `.vibe-secure/findings-<area>.json`. Validate with `node scripts/validate-findings.mjs <file.json>...`.

## File

| Field | Type | Notes |
|---|---|---|
| `area` | string | The area that produced the file, such as `database` |
| `generated_at` | string | ISO date and time |
| `mode` | `"audit"` or `"verify"` | |
| `findings` | Finding[] | |

## Finding

| Field | Type | Notes |
|---|---|---|
| `id` | string | Matches `^[a-z-]+-\d+$`, such as `db-1` |
| `check` | string | Stable check id, such as `db.rls-disabled` |
| `subject` | string | The thing affected: table, route or masked key. Merge dedupes on `check` + `subject` |
| `area` | string | Which audit area found it |
| `owasp` | string | OWASP id. Goes only here and in the report sub-line, never in the headline |
| `severity` | string | `critical`, `high`, `medium`, `low` or `unverified` |
| `title` | string | Plain-English consequence, in the second person |
| `impact` | string | What a stranger could do |
| `evidence` | Evidence[] | Proof. See below |
| `fix_plan` | string | What the fix changes |
| `fix_risk` | `{level, may_break}` | `level` is `low` or `high`; `may_break` says what could stop working |
| `manual_steps` | string[] | Steps only the user can do, such as rotating a key |
| `status` | string | `open`, `fixed`, `skipped` or `awaiting-user` |

## Evidence

Either `{ "file": "path", "line": 12 }` or `{ "url": "https://...", "status": 200, "summary": "what the response showed" }`.

## Rules

- No proof, no finding: every finding needs at least one evidence item.
- The exception is `unverified`. These may have empty evidence and appear only under "worth a look" in the report.
- Secrets are always masked, such as `sk_live_4f…a9`. The validator rejects any unmasked key in `title`, `impact`, `fix_plan`, `subject`, `manual_steps` or an evidence `summary`.

## Example

```json
{
  "id": "db-1",
  "check": "db.rls-disabled",
  "subject": "profiles",
  "area": "database",
  "owasp": "A01:2021 Broken Access Control",
  "severity": "critical",
  "title": "Anyone on the internet can read your users' profiles",
  "impact": "Row level security is off for the profiles table, so a stranger with your public key can list or change every user's profile.",
  "evidence": [
    { "file": "supabase/migrations/001_profiles.sql", "line": 8 },
    { "url": "https://xyz.supabase.co/rest/v1/profiles?select=*&limit=1", "status": 200, "summary": "Returned a row with no login; 1204 rows in total" }
  ],
  "fix_plan": "Turn on row level security for profiles and add a policy so each user can only read and edit their own row.",
  "fix_risk": { "level": "low", "may_break": "Pages that read other users' profiles will stop showing them until a policy allows it." },
  "manual_steps": [],
  "status": "open"
}
```
