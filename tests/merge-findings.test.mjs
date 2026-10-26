import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mergeFindings } from '../scripts/merge-findings.mjs';

const mk = (o = {}) => ({
  id: 'db-1', check: 'db.rls-disabled', subject: 'profiles', area: 'database',
  owasp: 'A01:2021 Broken Access Control', severity: 'high', title: 't', impact: 'i',
  evidence: [{ file: 'a.sql', line: 1 }], fix_plan: 'p',
  fix_risk: { level: 'low', may_break: 'nothing' }, manual_steps: [], status: 'open', ...o,
});
const doc = (area, findings) => ({ area, generated_at: '2026-10-22T00:00:00Z', mode: 'audit', findings });

test('same check and subject merge across files, keeping highest severity and all evidence', () => {
  const code = mk();
  const live = mk({ id: 'live-1', area: 'live', subject: 'Profiles', severity: 'critical',
    evidence: [{ url: 'https://x.co/rest/v1/profiles', status: 200, summary: 'rows' }] });
  const r = mergeFindings([doc('database', [code]), doc('live', [live])]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].severity, 'critical');
  assert.equal(r.findings[0].evidence.length, 2);
  assert.equal(r.findings[0].id, 'db-1');
});

test('duplicate evidence is deduped and manual steps unioned', () => {
  const a = mk({ manual_steps: ['rotate', 'redeploy'] });
  const b = mk({ id: 'db-2', manual_steps: ['rotate', 'tell users'] });
  const r = mergeFindings([doc('a', [a, b])]);
  assert.equal(r.findings[0].evidence.length, 1);
  assert.deepEqual(r.findings[0].manual_steps, ['rotate', 'redeploy', 'tell users']);
});

test('unverified goes to worth_a_look and is not counted', () => {
  const u = mk({ id: 'ai-1', check: 'ai.maybe', severity: 'unverified', evidence: [] });
  const r = mergeFindings([doc('a', [mk(), u])]);
  assert.equal(r.findings.length, 1);
  assert.equal(r.worth_a_look.length, 1);
  assert.deepEqual(r.counts, { critical: 0, high: 1, medium: 0, low: 0 });
});

test('sorted by severity, then area, then id; counts correct', () => {
  const f = [
    mk({ id: 'm-1', check: 'c.m', severity: 'medium' }),
    mk({ id: 'h-2', check: 'c.h2', severity: 'high', area: 'b' }),
    mk({ id: 'h-1', check: 'c.h1', severity: 'high', area: 'a' }),
    mk({ id: 'c-1', check: 'c.c', severity: 'critical' }),
    mk({ id: 'l-1', check: 'c.l', severity: 'low' }),
  ];
  const r = mergeFindings([doc('x', f)]);
  assert.deepEqual(r.findings.map((x) => x.id), ['c-1', 'h-1', 'h-2', 'm-1', 'l-1']);
  assert.deepEqual(r.counts, { critical: 1, high: 2, medium: 1, low: 1 });
});

test('fix_risk high wins over low', () => {
  const a = mk({ fix_risk: { level: 'low', may_break: 'a' } });
  const b = mk({ id: 'db-2', fix_risk: { level: 'high', may_break: 'logins' } });
  assert.equal(mergeFindings([doc('x', [a, b])]).findings[0].fix_risk.level, 'high');
  assert.equal(mergeFindings([doc('x', [b, a])]).findings[0].fix_risk.may_break, 'logins');
});

test('status precedence: awaiting-user > open > skipped > fixed, regardless of file order', () => {
  const st = (status, area, id) => mk({ status, area, id });
  const status = (...fs) => mergeFindings([doc('x', fs)]).findings[0].status;
  assert.equal(status(st('fixed', 'a', 'a-1'), st('awaiting-user', 'b', 'b-1')), 'awaiting-user');
  assert.equal(status(st('open', 'a', 'a-1'), st('awaiting-user', 'b', 'b-1')), 'awaiting-user');
  assert.equal(status(st('fixed', 'a', 'a-1'), st('open', 'b', 'b-1')), 'open');
  assert.equal(status(st('open', 'a', 'a-1'), st('fixed', 'b', 'b-1')), 'open');
  assert.equal(status(st('fixed', 'a', 'a-1'), st('skipped', 'b', 'b-1')), 'skipped');
  assert.equal(status(st('skipped', 'a', 'a-1'), st('open', 'b', 'b-1')), 'open');
  assert.equal(status(st('fixed', 'a', 'a-1'), st('fixed', 'b', 'b-1')), 'fixed');
});

test('merged finding lists every contributing area in areas; area stays the first', () => {
  const code = mk({ area: 'database-rules', id: 'database-rules-1', status: 'fixed' });
  const live = mk({ area: 'live', id: 'live-1', status: 'open', severity: 'critical' });
  const r = mergeFindings([doc('database-rules', [code]), doc('live', [live])]);
  assert.equal(r.findings.length, 1);
  assert.deepEqual(r.findings[0].areas, ['database-rules', 'live']);
  assert.equal(r.findings[0].area, 'database-rules');
  assert.equal(r.findings[0].status, 'open');
  const single = mergeFindings([doc('auth', [mk({ area: 'auth', check: 'auth.x' })])]);
  assert.deepEqual(single.findings[0].areas, ['auth']);
  const same = mergeFindings([doc('x', [mk({ area: 'live' }), mk({ area: 'live', id: 'live-2' })])]);
  assert.deepEqual(same.findings[0].areas, ['live']);
});

test('does not mutate its input', () => {
  const a = mk();
  const b = mk({ id: 'db-2', evidence: [{ file: 'b.sql', line: 2 }] });
  const before = JSON.stringify([a, b]);
  mergeFindings([doc('x', [a, b])]);
  assert.equal(JSON.stringify([a, b]), before);
});

test('CLI writes merged.json and skips invalid files with a warning', () => {
  const root = mkdtempSync(join(tmpdir(), 'vs-merge-'));
  const dir = join(root, '.vibe-secure', 'findings');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'good.json'), JSON.stringify(doc('database', [mk()])));
  writeFileSync(join(dir, 'bad.json'), JSON.stringify({ area: 'x' }));
  writeFileSync(join(dir, 'broken.json'), '{nope');
  const r = spawnSync(process.execPath, ['scripts/merge-findings.mjs', root], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /bad\.json/);
  assert.match(r.stderr, /broken\.json/);
  const merged = JSON.parse(readFileSync(join(root, '.vibe-secure', 'merged.json'), 'utf8'));
  assert.equal(merged.findings.length, 1);
  assert.deepEqual(merged.skipped_files.sort(), ['bad.json', 'broken.json']);
  assert.ok(!Number.isNaN(Date.parse(merged.generated_at)));
});

test('CLI with no findings dir writes empty merged.json', () => {
  const root = mkdtempSync(join(tmpdir(), 'vs-merge-'));
  mkdirSync(join(root, '.vibe-secure'));
  const r = spawnSync(process.execPath, ['scripts/merge-findings.mjs', root], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const merged = JSON.parse(readFileSync(join(root, '.vibe-secure', 'merged.json'), 'utf8'));
  assert.deepEqual(merged.findings, []);
  assert.deepEqual(merged.worth_a_look, []);
  assert.deepEqual(merged.counts, { critical: 0, high: 0, medium: 0, low: 0 });
});
