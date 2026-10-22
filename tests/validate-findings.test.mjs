import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEVERITIES, severityRank, validateFinding, validateFindingsFile,
  SECRET_PATTERNS, findUnmaskedSecrets,
} from '../scripts/validate-findings.mjs';

const good = () => ({
  id: 'db-1',
  check: 'db.rls-disabled',
  subject: 'profiles',
  area: 'database',
  owasp: 'A01:2021 Broken Access Control',
  severity: 'high',
  title: 'Anyone can read your users table',
  impact: 'Strangers can list every profile.',
  evidence: [{ file: 'supabase/migrations/001.sql', line: 12 }],
  fix_plan: 'Turn on row level security for profiles.',
  fix_risk: { level: 'low', may_break: 'Nothing expected.' },
  manual_steps: [],
  status: 'open',
});
const errs = (patch) => validateFinding({ ...good(), ...patch });
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

test('valid finding has no errors', () => assert.deepEqual(validateFinding(good()), []));

test('missing check', () => {
  const f = good(); delete f.check;
  assert.ok(validateFinding(f).some((e) => e.includes('check')));
});

test('bad severity', () => assert.ok(errs({ severity: 'severe' }).some((e) => e.includes('severity'))));

test('no proof, no finding', () => {
  assert.ok(errs({ evidence: [] }).length > 0);
  assert.deepEqual(errs({ evidence: [], severity: 'unverified' }), []);
});

test('evidence without line', () => assert.ok(errs({ evidence: [{ file: 'a.js' }] }).length > 0));

test('url evidence needs status and summary', () => {
  assert.deepEqual(errs({ evidence: [{ url: 'https://a.com/.env', status: 200, summary: 'file served' }] }), []);
  assert.ok(errs({ evidence: [{ url: 'https://a.com/.env' }] }).length > 0);
});

test('bad id', () => {
  assert.ok(errs({ id: 'DB_1' }).some((e) => e.includes('id')));
  assert.ok(errs({ id: 'db' }).some((e) => e.includes('id')));
});

test('fix_risk level', () => assert.ok(errs({ fix_risk: { level: 'medium', may_break: 'x' } }).length > 0));

test('unmasked secrets are flagged', () => {
  const stripe = 'sk_live_' + 'a1B2c3D4e5F6g7H8i9J0';
  assert.ok(errs({ title: `Key ${stripe} leaked` }).some((e) => e.includes('unmasked secret')));
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${b64u({ role: 'service_role' })}.sig_abc-123`;
  assert.ok(errs({ impact: jwt }).some((e) => e.includes('unmasked secret')));
  assert.ok(errs({ evidence: [{ url: 'https://a.com', status: 200, summary: stripe }] }).some((e) => e.includes('unmasked secret')));
  assert.ok(errs({ manual_steps: [stripe] }).some((e) => e.includes('unmasked secret')));
  assert.ok(errs({ subject: stripe }).some((e) => e.includes('unmasked secret')));
});

test('masked and non-service JWTs are not flagged', () => {
  assert.deepEqual(errs({ title: 'Key sk_live_4f…a9 leaked' }), []);
  const anon = `eyJhbGciOiJIUzI1NiJ9.${b64u({ role: 'anon' })}.sig_abc-123`;
  assert.deepEqual(findUnmaskedSecrets(anon), []);
});

test('findUnmaskedSecrets names matches; other providers', () => {
  assert.ok(findUnmaskedSecrets('AKIA' + 'ABCDEFGHIJKLMNOP').length > 0);
  assert.ok(findUnmaskedSecrets('sk-ant-' + 'a'.repeat(24)).length > 0);
  assert.ok(findUnmaskedSecrets('AIza' + 'a'.repeat(35)).length > 0);
  assert.ok(findUnmaskedSecrets('rk_live_' + 'a'.repeat(20)).length > 0);
  assert.deepEqual(findUnmaskedSecrets('nothing here'), []);
  assert.ok(Array.isArray(SECRET_PATTERNS) && SECRET_PATTERNS.length >= 7);
});

test('severityRank', () => {
  assert.ok(severityRank('critical') > severityRank('high'));
  assert.equal(severityRank('nope'), -1);
  assert.equal(severityRank('unverified'), 0);
  assert.deepEqual(SEVERITIES, ['critical', 'high', 'medium', 'low', 'unverified']);
});

test('validateFindingsFile', () => {
  const doc = { area: 'database', generated_at: new Date().toISOString(), mode: 'audit', findings: [good()] };
  assert.deepEqual(validateFindingsFile(doc), []);
  assert.ok(validateFindingsFile({ ...doc, mode: 'x' }).some((e) => e.includes('mode')));
  assert.ok(validateFindingsFile({ ...doc, generated_at: 'yesterday' }).some((e) => e.includes('generated_at')));
  assert.ok(validateFindingsFile({ ...doc, findings: [{ ...good(), severity: 'x' }] }).some((e) => e.includes('findings[0]')));
});

test('kebab-case words are not mistaken for keys; real keys still are', () => {
  for (const s of ['src/components/task-list-item-renderer.tsx', 'high-risk-user-data-exposure', 'mask-akia-aiza-sk_live_x']) {
    assert.deepEqual(findUnmaskedSecrets(s), [], s);
  }
  assert.deepEqual(errs({ subject: 'src/components/task-list-item-renderer.tsx' }), []);
  assert.ok(findUnmaskedSecrets('key: sk-proj-' + 'a1B2'.repeat(6)).includes('openai-key'));
  assert.ok(findUnmaskedSecrets('(sk-' + 'a1B2'.repeat(6) + ')').includes('openai-key'));
});
