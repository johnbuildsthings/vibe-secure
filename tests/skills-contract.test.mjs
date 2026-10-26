// Keeps every SKILL.md on demand only, and pins the orchestrator's contract with the area skills (Task 16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const skillsDir = new URL('../skills/', import.meta.url);
const AREAS = ['secrets', 'database-rules', 'auth', 'injection', 'payments', 'ai-features', 'config', 'dependencies', 'live'];

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'SKILL.md starts with a frontmatter block');
  return Object.fromEntries(
    m[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]),
  );
}

test('every skill is on demand only and named after its folder', () => {
  const dirs = readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.ok(dirs.includes('security-check'), 'skills/security-check exists');
  for (const area of AREAS) assert.ok(dirs.includes(`check-${area}`), `skills/check-${area} exists`);
  for (const name of dirs) {
    const fm = frontmatter(readFileSync(new URL(`${name}/SKILL.md`, skillsDir), 'utf8'));
    assert.equal(fm.name, name);
    assert.equal(fm['disable-model-invocation'], 'true', `${name} sets disable-model-invocation: true`);
    assert.ok(fm.description.startsWith('Use when'), `${name} description starts with "Use when"`);
  }
});

test('security-check has the Run / Report / Fix loop sections and leans on shared/report-and-fix.md', () => {
  const file = new URL('security-check/SKILL.md', skillsDir);
  assert.ok(existsSync(file));
  const md = readFileSync(file, 'utf8');
  assert.ok(frontmatter(md).description.startsWith('Use when the user wants a full security audit of their app'));
  for (const h of ['## Run', '## Report', '## Fix loop']) assert.ok(md.includes(`\n${h}\n`), `has heading ${h}`);
  assert.ok(md.includes('shared/report-and-fix.md'));
  assert.ok(md.includes('init-workspace.mjs <p> --full'));
  assert.ok(
    md.includes('dispatched: audit. Project root: <p>. Plugin root: <r>. Read <r>/skills/check-<area>/SKILL.md and follow it.'),
    'area dispatch prompt is verbatim',
  );
  assert.ok(md.includes('dispatched: verify <check> <subject>'));
  for (const area of AREAS) assert.ok(md.includes(`\`${area}\``), `names area ${area}`);
  // Fix round 1: live re-checks go through check-live verify (exact request), never a bare safe-fetch GET;
  // the orchestrator may write the rotation reminder; no eval-mock port in examples (R48).
  assert.ok(md.includes('Never judge a live finding from your own bare `safe-fetch` request'));
  assert.ok(md.includes('both** the code verify and the live verify reply `GONE`'));
  assert.ok(md.includes('the rotation reminder finding'));
  assert.ok(md.includes('never dispatch `live` a second time'));
  assert.ok(!md.includes('4100') && !md.includes('4101'), 'no live-mock ports in the skill');
  for (const field of ['"url"', '"hosts"', '"confirmed_by_user"', '"confirmed_at"']) {
    assert.ok(md.includes(field), `live-scope.json example has ${field}`);
  }
});

test('report-and-fix.md says report-only runs still validate, merge and save the report (R46)', () => {
  const doc = readFileSync(new URL('../shared/report-and-fix.md', import.meta.url), 'utf8');
  assert.match(doc, /report only[^\n]*still[^\n]*validate[^\n]*merge[^\n]*save/i);
});
