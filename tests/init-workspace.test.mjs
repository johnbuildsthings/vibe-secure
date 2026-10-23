import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initWorkspace } from '../scripts/init-workspace.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'vs-init-'));

test('creates findings dir and a new .gitignore', () => {
  const root = tmp();
  initWorkspace(root, { full: false });
  assert.ok(existsSync(join(root, '.vibe-secure', 'findings')));
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), '.vibe-secure/\n');
});

test('running twice adds the ignore line once', () => {
  const root = tmp();
  initWorkspace(root, { full: false });
  initWorkspace(root, { full: false });
  const lines = readFileSync(join(root, '.gitignore'), 'utf8').split('\n').filter((l) => l === '.vibe-secure/');
  assert.equal(lines.length, 1);
});

test('adds a newline before appending when the file lacks one', () => {
  const root = tmp();
  writeFileSync(join(root, '.gitignore'), 'node_modules');
  initWorkspace(root, { full: false });
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), 'node_modules\n.vibe-secure/\n');
});

test('an existing bare .vibe-secure line counts', () => {
  const root = tmp();
  writeFileSync(join(root, '.gitignore'), '.vibe-secure\n');
  initWorkspace(root, { full: false });
  assert.equal(readFileSync(join(root, '.gitignore'), 'utf8'), '.vibe-secure\n');
});

function seed(root) {
  const ws = join(root, '.vibe-secure');
  mkdirSync(join(ws, 'findings'), { recursive: true });
  for (const f of ['findings/secrets.json', 'merged.json', 'report.md', 'live-requests.log', 'live-scope.json', 'stack.json']) {
    writeFileSync(join(ws, f), 'x');
  }
  return ws;
}

test('full removes old results but keeps stack.json', () => {
  const root = tmp();
  const ws = seed(root);
  initWorkspace(root, { full: true });
  for (const f of ['findings/secrets.json', 'merged.json', 'report.md', 'live-requests.log', 'live-scope.json']) {
    assert.ok(!existsSync(join(ws, f)), f);
  }
  assert.ok(existsSync(join(ws, 'stack.json')));
});

test('non-full keeps existing results', () => {
  const root = tmp();
  const ws = seed(root);
  initWorkspace(root, { full: false });
  assert.ok(existsSync(join(ws, 'findings', 'secrets.json')));
  assert.ok(existsSync(join(ws, 'report.md')));
});

test('rotations.json survives both full and non-full init (R18)', () => {
  for (const full of [true, false]) {
    const root = tmp();
    const ws = seed(root);
    writeFileSync(join(ws, 'rotations.json'), '{"rotations":[]}');
    initWorkspace(root, { full });
    assert.equal(readFileSync(join(ws, 'rotations.json'), 'utf8'), '{"rotations":[]}', `full=${full}`);
  }
});

test('full also removes stale single-area reports', () => {
  const root = tmp();
  const ws = seed(root);
  writeFileSync(join(ws, 'report-secrets.md'), 'x');
  initWorkspace(root, { full: true });
  assert.ok(!existsSync(join(ws, 'report-secrets.md')));
});
