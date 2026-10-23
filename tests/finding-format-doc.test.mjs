// Keeps shared/finding-format.md in step with the validator and the rulings (R7, R15).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateFinding } from '../scripts/validate-findings.mjs';

const doc = readFileSync(new URL('../shared/finding-format.md', import.meta.url), 'utf8');

test('the example finding is valid and uses canonical names', () => {
  const json = doc.match(/## Example\s+```json\n([\s\S]*?)```/)[1];
  const f = JSON.parse(json);
  assert.deepEqual(validateFinding(f), []);
  assert.equal(f.area, 'database-rules');
  assert.equal(f.id, 'database-rules-1');
  assert.match(f.owasp, /^A01:2025/);
});

test('the doc names the canonical findings path, not the old one', () => {
  assert.ok(doc.includes('.vibe-secure/findings/<area>.json'));
  assert.ok(!doc.includes('findings-<area>.json'));
});

test('git-history evidence with a commit field is valid', () => {
  const ev = doc.match(/`(\{ "file": "[^"]+", "line": \d+, "commit": "[0-9a-f]+" \})`/)[1];
  const f = JSON.parse(doc.match(/## Example\s+```json\n([\s\S]*?)```/)[1]);
  assert.deepEqual(validateFinding({ ...f, evidence: [JSON.parse(ev)] }), []);
});
