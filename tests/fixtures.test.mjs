import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, cpSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { detectStack } from '../scripts/detect-stack.mjs';
import { SEVERITIES } from '../scripts/validate-findings.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures');
const AREAS = ['secrets', 'database-rules', 'auth', 'injection', 'payments', 'ai-features', 'config', 'dependencies', 'live'];
const EXPECTED_FRAMEWORK = {
  'nextjs-supabase-leaky': 'next',
  'react-firebase-open': 'react-vite',
  'next-openai-chatbot': 'next',
  'secure-baseline': 'next',
  'python-flask-generic': 'unknown',
};

for (const [name, framework] of Object.entries(EXPECTED_FRAMEWORK)) {
  const dir = join(FIX, name);

  test(`${name}: expected-findings.json is well formed`, () => {
    const doc = JSON.parse(readFileSync(join(dir, 'expected-findings.json'), 'utf8'));
    assert.equal(doc.fixture, name);
    assert.equal(typeof doc.baseline, 'boolean');
    assert.ok(Array.isArray(doc.ignore_checks));
    assert.ok(Array.isArray(doc.expected));
    for (const e of doc.expected) {
      assert.equal(typeof e.check, 'string');
      assert.ok(SEVERITIES.includes(e.min_severity), `${e.check}: bad severity ${e.min_severity}`);
      assert.ok(AREAS.includes(e.area), `${e.check}: bad area ${e.area}`);
    }
    if (doc.baseline) assert.deepEqual(doc.expected, []);
    else assert.ok(doc.expected.length > 0);
  });

  test(`${name}: smoke.mjs passes`, () => {
    execFileSync('node', [join(dir, 'smoke.mjs')], { stdio: 'pipe' });
  });

  test(`${name}: detectStack finds ${framework}`, () => {
    const { apps } = detectStack(dir);
    assert.equal(apps.length, 1);
    assert.equal(apps[0].framework, framework);
    if (name === 'python-flask-generic') assert.equal(apps[0].language, 'python');
  });

  test(`${name}: nothing installed, small, lockfile for js apps`, () => {
    assert.ok(!existsSync(join(dir, 'node_modules')));
    const count = (d) => readdirSync(d, { withFileTypes: true })
      .reduce((n, e) => n + (e.isDirectory() ? count(join(d, e.name)) : e.name === 'package-lock.json' ? 0 : 1), 0);
    assert.ok(count(dir) <= 16, `${name} has ${count(dir)} files`);
    if (name !== 'python-flask-generic') assert.ok(existsSync(join(dir, 'package-lock.json')));
  });
}

test('leaky: expected-live.json', () => {
  const doc = JSON.parse(readFileSync(join(FIX, 'nextjs-supabase-leaky', 'expected-live.json'), 'utf8'));
  assert.equal(doc.baseline, false);
  assert.deepEqual(doc.ignore_checks, []);
  assert.deepEqual(doc.expected.map((e) => [e.check, e.subject, e.min_severity, e.area]), [
    ['db.rls-disabled', 'profiles', 'critical', 'live'],
    ['live.exposed-file', '.env', 'critical', 'live'],
  ]);
});

test('leaky: history.sh leaves a key in git history only', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'leaky-'));
  const dir = join(tmp, 'app');
  cpSync(join(FIX, 'nextjs-supabase-leaky'), dir, { recursive: true });
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  execFileSync('bash', [join(FIX, 'nextjs-supabase-leaky', 'history.sh')], { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  assert.ok(!existsSync(join(dir, '.env.local')));
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^\.env\.local$/m);
  const first = git('rev-list', '--max-parents=0', 'HEAD').trim();
  const histKey = git('show', `${first}:.env.local`).match(/sk_live_[A-Za-z0-9]{40}/)?.[0];
  assert.ok(histKey, 'history holds a 40-char sk_live key');
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.name === '.git' ? [] : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  for (const f of walk(join(FIX, 'nextjs-supabase-leaky'))) {
    if (f.endsWith('history.sh')) continue;
    assert.ok(!readFileSync(f, 'utf8').includes(histKey), `${f} must not contain the history-only key`);
  }
});

function startMock(violations, fixture = 'nextjs-supabase-leaky') {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [join(FIX, 'live-mock', 'server.mjs'), '--app-port', '0', '--db-port', '0', '--violations', violations, '--fixture', fixture], { stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      const line = buf.split('\n').find((l) => l.startsWith('{'));
      if (line) resolve({ child, ...JSON.parse(line) });
    });
    child.on('error', reject);
    child.on('exit', (c) => reject(new Error(`mock exited ${c}`)));
  });
}

test('live mock: serves exposures, records rule-breaking requests', async () => {
  const vfile = join(mkdtempSync(join(tmpdir(), 'mock-')), 'violations.log');
  const { child, app, db } = await startMock(vfile);
  child.removeAllListeners('exit');
  try {
    const anon = readFileSync(join(FIX, 'nextjs-supabase-leaky', '.env'), 'utf8').match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)$/m)[1];
    const A = `http://127.0.0.1:${app}`;
    const D = `http://127.0.0.1:${db}`;

    const home = await fetch(`${A}/`);
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('content-security-policy'), null);
    assert.equal(home.headers.get('strict-transport-security'), null);
    assert.equal(home.headers.get('x-frame-options'), null);
    assert.equal((await fetch(`${A}/.env`)).status, 200);
    assert.equal((await fetch(`${A}/_next/static/chunks/main.js.map`)).status, 200);
    const users = await fetch(`${A}/api/users`);
    assert.equal(users.status, 200);
    assert.ok(Array.isArray(await users.json()));

    const ok = await fetch(`${D}/rest/v1/profiles?select=*&limit=1`, { headers: { apikey: anon, Prefer: 'count=exact' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-range'), '0-0/1204');
    const plain = await fetch(`${D}/rest/v1/profiles?select=*&limit=1`, { headers: { apikey: anon } });
    assert.equal(plain.headers.get('content-range'), '0-0/*');
    assert.equal((await ok.json()).length, 1);
    assert.equal((await fetch(`${D}/rest/v1/profiles?select=*&limit=1`, { headers: { apikey: 'wrong' } })).status, 401);
    assert.ok(!existsSync(vfile) || readFileSync(vfile, 'utf8') === '', 'good requests record nothing');

    const post = await fetch(`${D}/rest/v1/profiles?limit=1`, { method: 'POST', headers: { apikey: anon }, body: '{}' });
    assert.equal(post.status, 405);
    const nolimit = await fetch(`${D}/rest/v1/profiles?select=*`, { headers: { apikey: anon } });
    assert.equal(nolimit.status, 405);
    assert.equal((await fetch(`${A}/api/users`, { method: 'DELETE' })).status, 405);

    const lines = readFileSync(vfile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 3);
    assert.deepEqual(lines.map((l) => l.method), ['POST', 'GET', 'DELETE']);
  } finally {
    child.kill();
  }
});
