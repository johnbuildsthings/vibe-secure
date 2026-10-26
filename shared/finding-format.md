# Finding format

Every audit skill writes its results to `.vibe-secure/findings/<area>.json`. It writes the file on every audit run, with `"findings": []` when nothing is wrong. Validate with `node scripts/validate-findings.mjs <file.json>...`.

The `area` is the skill name without `check-`: `secrets`, `database-rules`, `auth`, `injection`, `payments`, `ai-features`, `config`, `dependencies` or `live`.

## File

| Field | Type | Notes |
|---|---|---|
| `area` | string | The area that produced the file, such as `database-rules` |
| `generated_at` | string | ISO date and time |
| `mode` | `"audit"` or `"verify"` | |
| `findings` | Finding[] | |

## Finding

| Field | Type | Notes |
|---|---|---|
| `id` | string | `<area>-<n>`, matching `^[a-z-]+-\d+$`, such as `database-rules-1` |
| `check` | string | Stable check id, such as `db.rls-disabled` |
| `subject` | string | The thing affected: table, route or masked key. Merge dedupes on `check` + `subject` |
| `area` | string | Which audit area found it. Same value as the file's `area` |
| `owasp` | string | OWASP id, such as `A01:2025 Broken Access Control` or `LLM01`. Goes only here and in the report sub-line, never in the headline |
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

File paths are relative to the project root.

Evidence found in git history (`secrets.key-in-git-history`) adds an optional `commit` field with the short hash of the commit holding that file and line: `{ "file": "config/payments.env", "line": 2, "commit": "abc1234" }`. The file may no longer exist in the current tree.

## Rules

- No proof, no finding: every finding needs at least one evidence item.
- The exception is `unverified`. These may have empty evidence and appear only under "worth a look" in the report.
- Secrets are always masked, such as `sk_live_4f…a9`. The validator rejects any unmasked key in `title`, `impact`, `fix_plan`, `subject`, `manual_steps` or an evidence `summary`.

## Merged results

`merge-findings` writes `.vibe-secure/merged.json`. It merges findings with the same `check` + `subject` from every area file into one finding. Each merged finding keeps the fields above and adds `areas`: every area that reported it, such as `["database-rules", "live"]`. Its `area` is the first of those. To pick one area's findings, test whether that area is in `areas`, not `area`.

The merged `status` follows this order: `awaiting-user`, then `open`, then `skipped`, then `fixed`. A merged finding is `fixed` only when every copy of it is fixed.

## Example

```json
{
  "id": "database-rules-1",
  "check": "db.rls-disabled",
  "subject": "orders",
  "area": "database-rules",
  "owasp": "A01:2025 Broken Access Control",
  "severity": "critical",
  "title": "Anyone on the internet can read every customer's orders",
  "impact": "Row level security is off for the orders table, so a stranger with your public key can list or change every customer's orders.",
  "evidence": [
    { "file": "db/migrations/20250301_create_orders.sql", "line": 12 },
    { "url": "https://xyz.supabase.co/rest/v1/orders?select=*&limit=1", "status": 200, "summary": "Returned a row with no login; 87 rows in total" }
  ],
  "fix_plan": "Turn on row level security for orders and add a policy so each customer can only read their own orders.",
  "fix_risk": { "level": "low", "may_break": "Admin pages that list everyone's orders will stop showing them until a policy allows it." },
  "manual_steps": [],
  "status": "open"
}
```
