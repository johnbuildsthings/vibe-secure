import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { detectStack } from '../scripts/detect-stack.mjs';

function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'detect-stack-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}
const pkg = (deps = {}, dev = {}) => ({ dependencies: deps, devDependencies: dev });

test('next + supabase + stripe + openai + vercel', () => {
  const root = project({
    'package.json': pkg({ next: '14', '@supabase/supabase-js': '2', stripe: '1', openai: '4' }),
    'vercel.json': '{}',
  });
  assert.deepEqual(detectStack(root).apps, [
    { path: '.', language: 'js', framework: 'next', db: ['supabase'], payments: ['stripe'], ai: ['openai'], host: 'vercel', generator: null },
  ]);
});

test('vite + react + firebase hosting', () => {
  const root = project({
    'package.json': pkg({ react: '18', firebase: '10' }, { vite: '5' }),
    'firebase.json': '{"hosting":{"public":"dist"}}',
  });
  const [app] = detectStack(root).apps;
  assert.equal(app.framework, 'react-vite');
  assert.deepEqual(app.db, ['firebase']);
  assert.equal(app.host, 'firebase');
});

test('monorepo without root package.json', () => {
  const root = project({
    'apps/web/package.json': pkg({ next: '14' }),
    'apps/api/package.json': pkg({ express: '4' }),
  });
  const apps = detectStack(root).apps;
  assert.deepEqual(apps.map((a) => [a.path, a.framework]), [['apps/api', 'express'], ['apps/web', 'next']]);
});

test('build dirs and node_modules are ignored', () => {
  const root = project({
    'node_modules/x/package.json': pkg(),
    '.next/package.json': pkg(),
    'dist/requirements.txt': 'flask',
  });
  assert.deepEqual(detectStack(root).apps, []);
});

test('python-only app', () => {
  const root = project({ 'requirements.txt': 'flask\n' });
  assert.deepEqual(detectStack(root).apps, [
    { path: '.', language: 'python', framework: 'unknown', db: [], payments: [], ai: [], host: 'unknown', generator: null },
  ]);
});

test('empty dir', () => {
  assert.deepEqual(detectStack(project({})).apps, []);
});

test('lovable-tagger and .bolt', () => {
  assert.equal(detectStack(project({ 'package.json': pkg({}, { 'lovable-tagger': '1' }) })).apps[0].generator, 'lovable');
  assert.equal(detectStack(project({ 'package.json': pkg(), '.bolt/config.json': '{}' })).apps[0].generator, 'bolt');
});

test('other db, ai, payments and host rules', () => {
  const root = project({
    'package.json': pkg({ '@remix-run/node': '2', '@prisma/client': '5', mongoose: '8', 'drizzle-orm': '1', '@stripe/stripe-js': '1', '@anthropic-ai/sdk': '1', '@google/genai': '1', ai: '3' }),
    'supabase/config.toml': '',
    'firestore.rules': '',
    'netlify.toml': '',
  });
  const [app] = detectStack(root).apps;
  assert.equal(app.framework, 'remix');
  assert.deepEqual([...app.db].sort(), ['drizzle', 'firebase', 'mongodb', 'prisma', 'supabase']);
  assert.deepEqual(app.payments, ['stripe']);
  assert.deepEqual([...app.ai].sort(), ['anthropic', 'google', 'vercel-ai']);
  assert.equal(app.host, 'netlify');
});

test('package.json plus Python manifest is one js app; malformed package.json does not throw', () => {
  const root = project({ 'package.json': pkg({ express: '4' }), 'requirements.txt': '' });
  const apps = detectStack(root).apps;
  assert.equal(apps.length, 1);
  assert.equal(apps[0].language, 'js');
  const bad = project({ 'package.json': '{not json' });
  assert.equal(detectStack(bad).apps[0].framework, 'unknown');
});

test('discovery stops below depth 3', () => {
  const root = project({ 'a/b/c/package.json': pkg(), 'a/b/c/d/package.json': pkg() });
  assert.deepEqual(detectStack(root).apps.map((a) => a.path), ['a/b/c']);
});

test('CLI writes stack.json equal to detectStack output', () => {
  const root = project({ 'package.json': pkg({ next: '14' }) });
  const script = new URL('../scripts/detect-stack.mjs', import.meta.url).pathname;
  const out = execFileSync('node', [script, root], { encoding: 'utf8' });
  const written = JSON.parse(readFileSync(join(root, '.vibe-secure', 'stack.json'), 'utf8'));
  assert.deepEqual(written, detectStack(root));
  assert.deepEqual(JSON.parse(out), written);
});
