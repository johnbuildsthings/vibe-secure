import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { scoreRun, validateExpected } from '../evals/score-run.mjs';

const finding = (o = {}) => ({
  id: 'db-1', check: 'db.rls-disabled', subject: 'public.profiles', area: 'database-rules',
  owasp: 'A01:2021 Broken Access Control', severity: 'critical', title: 'Anyone can read your users',
  impact: 'Strangers can list every profile.', evidence: [{ file: 'a.sql', line: 1 }],
  fix_plan: 'Turn on RLS.', fix_risk: { level: 'low', may_break: 'Nothing.' }, manual_steps: [],
  status: 'open', ...o,
});
const docA = (area, ...findings) => ({ area, generated_at: '2026-01-01T00:00:00Z', mode: 'audit', findings });
const doc = (...findings) => docA('database-rules', ...findings);
const exp = (o = {}) => ({ check: 'db.rls-disabled', subject: 'profiles', min_severity: 'high', area: 'database-rules', ...o });
const edoc = (...expected) => ({ fixture: 'f', baseline: false, ignore_checks: [], expected });
const base = (ignore = []) => ({ fixture: 'b', baseline: true, ignore_checks: ignore, expected: [] });

test('all expected present passes', () => {
  const r = scoreRun(edoc(exp()), [doc(finding())]);
  assert.equal(r.pass, true);
  assert.deepEqual(r.missed, []);
});

test('missing expectation fails and is listed', () => {
  const r = scoreRun(edoc(exp(), exp({ check: 'pay.client-price', subject: '/api/checkout', area: 'payments' })), [doc(finding())]);
  assert.equal(r.pass, false);
  assert.deepEqual(r.missed.map((m) => m.check), ['pay.client-price']);
});

test('severity too low is missed', () => {
  const r = scoreRun(edoc(exp()), [doc(finding({ severity: 'medium' }))]);
  assert.equal(r.pass, false);
  assert.equal(r.missed.length, 1);
});

test('higher severity than required is fine', () => {
  assert.equal(scoreRun(edoc(exp({ min_severity: 'high' })), [doc(finding({ severity: 'critical' }))]).pass, true);
});

test('subject mismatch is missed; subject match is case-insensitive', () => {
  assert.equal(scoreRun(edoc(exp()), [doc(finding({ subject: 'orders' }))]).pass, false);
  assert.equal(scoreRun(edoc(exp({ subject: 'PROFILES' })), [doc(finding())]).pass, true);
});

test('expectation without subject matches on check alone', () => {
  const e = exp(); delete e.subject;
  assert.equal(scoreRun(edoc(e), [doc(finding({ subject: 'anything' }))]).pass, true);
});

test('missed medium/low expectations go to info and do not gate', () => {
  const r = scoreRun(edoc(exp(), exp({ check: 'cfg.missing-headers', min_severity: 'low', area: 'config' })), [doc(finding())]);
  assert.equal(r.pass, true);
  assert.deepEqual(r.missed, []);
  assert.ok(r.info.some((i) => i.includes('cfg.missing-headers')));
});

test('baseline with a high finding fails', () => {
  const r = scoreRun(base(), [doc(finding({ severity: 'high' }))]);
  assert.equal(r.pass, false);
  assert.equal(r.false_positives.length, 1);
});

test('baseline ignores ignore_checks, medium and low', () => {
  const ds = [doc(finding({ check: 'deps.known-vuln', severity: 'high' }), finding({ id: 'x-2', severity: 'medium' }))];
  assert.equal(scoreRun(base(['deps.known-vuln']), ds).pass, true);
});

test('area filter ignores other areas\' expectations', () => {
  const e = edoc(exp(), exp({ check: 'pay.client-price', subject: '/api/checkout', area: 'payments' }));
  assert.equal(scoreRun(e, [doc(finding())], { area: 'database-rules' }).pass, true);
  assert.equal(scoreRun(e, [doc(finding())], { area: 'payments' }).pass, false);
});

test('area filter also limits baseline false positives', () => {
  const ds = [doc(finding({ severity: 'high', area: 'auth' }))];
  assert.equal(scoreRun(base(), [...ds, docA('secrets')], { area: 'secrets' }).pass, true);
  assert.equal(scoreRun(base(), ds, { area: 'auth' }).pass, false);
});

test('area with no gating expectations on a non-baseline doc warns but passes', () => {
  const r = scoreRun(edoc(exp()), [docA('secrets')], { area: 'secrets' });
  assert.equal(r.pass, true);
  assert.ok(r.info.some((i) => i.startsWith('NO GATING EXPECTATIONS for area secrets')));
});

test('baseline with an area does not print the no-gating warning', () => {
  const r = scoreRun(base(), [docA('secrets')], { area: 'secrets' });
  assert.ok(!r.info.some((i) => i.includes('NO GATING')));
});

test('invalid findings file fails', () => {
  const r = scoreRun(edoc(exp()), [{ area: 'x', findings: [] }, doc(finding())]);
  assert.equal(r.pass, false);
  assert.ok(r.invalid.length > 0);
});

test('no findings files fails for a normal run', () => {
  const r = scoreRun(edoc(exp()), []);
  assert.equal(r.pass, false);
  assert.deepEqual(r.invalid, ['no findings files']);
});

test('empty or missing findings dir fails, even for baseline', () => {
  for (const o of [{}, { dirMissing: true }]) {
    const r = scoreRun(base(), [], o);
    assert.equal(r.pass, false);
    assert.deepEqual(r.invalid, ['no findings files']);
  }
  assert.equal(scoreRun(base(), [doc()]).pass, true);
});

test('--area requires a valid findings doc for that area', () => {
  const r = scoreRun(edoc(exp()), [doc(finding())], { area: 'payments' });
  assert.equal(r.pass, false);
  assert.ok(r.invalid.some((i) => i.includes('area payments')));
  assert.equal(scoreRun(base(), [doc()], { area: 'secrets' }).pass, false);
});

test('invert: every gating area must have been audited', () => {
  const e = edoc(exp(), exp({ check: 'pay.client-price', subject: '/api/checkout', area: 'payments' }));
  const r = scoreRun(e, [doc()], { invert: true });
  assert.equal(r.pass, false);
  assert.ok(r.invalid.includes('NOT AUDITED: payments'));
  assert.equal(scoreRun(e, [doc(), docA('payments')], { invert: true }).pass, true);
});

test('invert: an invalid doc does not count as auditing its area', () => {
  const bad = { ...docA('payments'), mode: 'nope' };
  const e = edoc(exp({ check: 'pay.client-price', area: 'payments' }));
  assert.ok(scoreRun(e, [bad], { invert: true }).invalid.includes('NOT AUDITED: payments'));
});

test('no --area and no gating expectations on a non-baseline doc fails', () => {
  const r = scoreRun(edoc(exp({ min_severity: 'low' })), [doc()]);
  assert.equal(r.pass, false);
});

test('validateExpected rejects malformed expectation docs', () => {
  const ok = edoc(exp());
  assert.doesNotThrow(() => validateExpected(ok));
  const bads = [
    { ...ok, expected: 'x' }, { ...ok, baseline: 'false' }, { ...ok, expected: [exp({ check: undefined })] },
    { ...ok, expected: [exp({ area: '' })] }, { ...ok, expected: [exp({ min_severity: 'severe' })] },
    { ...ok, ignore_checks: 'a' }, null, [],
  ];
  for (const b of bads) assert.throws(() => validateExpected(b));
});

test('CLI exits 1 on a malformed expectations file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'score-'));
  writeFileSync(join(dir, 'e.json'), JSON.stringify({ baseline: false, expected: [{ check: 'a', area: 'b', min_severity: 'huge' }] }));
  const r = spawnSync('node', ['evals/score-run.mjs', '--expected', join(dir, 'e.json'), '--findings', dir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /min_severity/);
});

test('invert: expectations must be absent', () => {
  const e = edoc(exp());
  assert.equal(scoreRun(e, [doc()], { invert: true }).pass, true);
  const r = scoreRun(e, [doc(finding({ severity: 'low' }))], { invert: true });
  assert.equal(r.pass, false);
  assert.equal(r.missed.length, 1);
});

test('invert: a fixed finding still counts as present', () => {
  assert.equal(scoreRun(edoc(exp()), [doc(finding({ status: 'fixed' }))], { invert: true }).pass, false);
});

const hist = () => exp({ check: 'secrets.key-in-git-history', subject: 'sk_live', area: 'secrets' });
const histF = (status) => finding({ id: 'secrets-1', check: 'secrets.key-in-git-history', subject: 'sk_live_4f…a9', area: 'secrets', status });

test('invert: key-in-git-history must be awaiting-user', () => {
  const e = edoc(hist());
  assert.equal(scoreRun(e, [docA('secrets', histF('awaiting-user'))], { invert: true }).pass, true);
  assert.equal(scoreRun(e, [docA('secrets', histF('fixed'))], { invert: true }).pass, false);
  assert.equal(scoreRun(e, [docA('secrets', histF('open'))], { invert: true }).pass, false);
  assert.equal(scoreRun(e, [docA('secrets')], { invert: true }).pass, false);
});

test('invert: medium/low expectations do not gate', () => {
  const e = edoc(exp(), exp({ check: 'cfg.missing-headers', min_severity: 'low', area: 'config' }));
  assert.equal(scoreRun(e, [doc(), docA('config', finding({ check: 'cfg.missing-headers', area: 'config' }))], { invert: true }).pass, true);
});

test('multiple expected docs merge via CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'score-'));
  mkdirSync(join(dir, 'findings'));
  writeFileSync(join(dir, 'a.json'), JSON.stringify(edoc(exp())));
  writeFileSync(join(dir, 'b.json'), JSON.stringify(edoc(exp({ check: 'live.exposed-file', subject: '.env', area: 'live' }))));
  writeFileSync(join(dir, 'findings', 'x.json'), JSON.stringify(doc(finding())));
  const run = (...a) => spawnSync('node', ['evals/score-run.mjs', '--findings', join(dir, 'findings'), ...a], { encoding: 'utf8' });
  const both = run('--expected', join(dir, 'a.json'), '--expected', join(dir, 'b.json'));
  assert.equal(both.status, 1);
  assert.match(both.stdout, /live\.exposed-file/);
  assert.equal(run('--expected', join(dir, 'a.json')).status, 0);
  assert.equal(run('--expected', join(dir, 'a.json'), '--findings', join(dir, 'nope')).status, 1);
});
