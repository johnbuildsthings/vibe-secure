import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { safeFetch } from '../scripts/safe-fetch.mjs';

const STRIPE = 'sk_live_4f' + 'X'.repeat(40) + 'a9';
let server, port, hits, root;
const fast = { delayMs: 0, timeoutMs: 2000 };

before(async () => {
  server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url.startsWith('/redirect')) {
      res.writeHead(302, { location: 'http://evil.example/' });
      return res.end();
    }
    if (req.url.startsWith('/slow')) return; // never answers
    if (req.url.startsWith('/big')) {
      res.writeHead(200);
      return res.end('A'.repeat(6 * 1024 * 1024));
    }
    res.writeHead(200, { 'content-type': 'text/plain', 'x-key': STRIPE });
    res.end(`hello alice@example.com ${STRIPE}`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => { server.closeAllConnections?.(); server.close(); });

function writeScope(hosts, extra = {}) {
  fs.mkdirSync(path.join(root, '.vibe-secure'), { recursive: true });
  fs.writeFileSync(path.join(root, '.vibe-secure/live-scope.json'),
    JSON.stringify({ hosts, confirmed_by_user: true, confirmed_at: new Date().toISOString(), ...extra }));
}
const logPath = () => path.join(root, '.vibe-secure/live-requests.log');
const url = (p = '/') => `http://127.0.0.1:${port}${p}`;

beforeEach(() => {
  hits = [];
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-'));
  writeScope([`127.0.0.1:${port}`]);
});

test('refuses without a scope file (no-scope)', async () => {
  fs.rmSync(path.join(root, '.vibe-secure'), { recursive: true });
  assert.deepEqual(await safeFetch(url(), { root, ...fast }), { refused: 'no-scope' });
  assert.equal(hits.length, 0);
});

test('refuses when confirmed_by_user is not true (no-scope)', async () => {
  writeScope([`127.0.0.1:${port}`], { confirmed_by_user: 'yes' });
  assert.deepEqual(await safeFetch(url(), { root, ...fast }), { refused: 'no-scope' });
  writeScope([`127.0.0.1:${port}`], { confirmed_by_user: false });
  assert.deepEqual(await safeFetch(url(), { root, ...fast }), { refused: 'no-scope' });
  assert.equal(hits.length, 0);
});

test('refuses malformed scope file (no-scope)', async () => {
  fs.writeFileSync(path.join(root, '.vibe-secure/live-scope.json'), '{nope');
  assert.deepEqual(await safeFetch(url(), { root, ...fast }), { refused: 'no-scope' });
  fs.writeFileSync(path.join(root, '.vibe-secure/live-scope.json'), JSON.stringify({ confirmed_by_user: true }));
  assert.deepEqual(await safeFetch(url(), { root, ...fast }), { refused: 'no-scope' });
  assert.equal(hits.length, 0);
});

test('refuses non GET/HEAD methods (method-not-allowed)', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'get']) {
    assert.deepEqual(await safeFetch(url(), { root, method, ...fast }), { refused: 'method-not-allowed' }, method);
  }
  assert.equal(hits.length, 0);
});

test('refuses hosts not in scope, and localhost vs 127.0.0.1', async () => {
  assert.deepEqual(await safeFetch(`http://localhost:${port}/`, { root, ...fast }), { refused: 'host-not-in-scope' });
  assert.deepEqual(await safeFetch('http://evil.example/', { root, ...fast }), { refused: 'host-not-in-scope' });
  assert.deepEqual(await safeFetch(`http://127.0.0.1:${port + 1}/`, { root, ...fast }), { refused: 'host-not-in-scope' });
  assert.deepEqual(await safeFetch('ftp://127.0.0.1/', { root, ...fast }), { refused: 'host-not-in-scope' });
  assert.deepEqual(await safeFetch('not a url', { root, ...fast }), { refused: 'host-not-in-scope' });
  assert.equal(hits.length, 0);
});

test('scope entry without a port does not match a URL with a port', async () => {
  writeScope(['127.0.0.1']);
  assert.deepEqual(await safeFetch(url(), { root, ...fast }), { refused: 'host-not-in-scope' });
  assert.equal(hits.length, 0);
});

test('scope matching is case-insensitive', async () => {
  writeScope([`127.0.0.1:${port}`.toUpperCase()]);
  const r = await safeFetch(url('/x'), { root, ...fast });
  assert.equal(r.status, 200);
});

test('scope normalization: path and trailing slash in URL are fine', async () => {
  const r = await safeFetch(url('/some/path/'), { root, ...fast });
  assert.equal(r.status, 200);
  assert.deepEqual(hits, ['GET /some/path/']);
});

test('refuses unbounded reads (unbounded-read)', async () => {
  writeScope([`127.0.0.1:${port}`, 'x.supabase.co', 'firestore.googleapis.com', 'p.firebaseio.com', 'p.firebasedatabase.app']);
  const bad = [
    url('/rest/v1/profiles'),
    url('/rest/v1/profiles?select=*&limit=10'),
    url('/rest/v1/profiles?limit=11'),
    'https://x.supabase.co/rest/v1/profiles?select=*',
    'https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/users',
    'https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/users?pageSize=20',
    'https://p.firebaseio.com/users.json',
    'https://p.firebaseio.com/users.json?shallow=false',
    'https://p.firebasedatabase.app/.json',
  ];
  for (const u of bad) {
    assert.deepEqual(await safeFetch(u, { root, ...fast }), { refused: 'unbounded-read' }, u);
  }
  assert.equal(hits.length, 0);
});

test('bounded reads are allowed', async () => {
  const r = await safeFetch(url('/rest/v1/profiles?select=*&limit=1'), { root, ...fast });
  assert.equal(r.status, 200);
  assert.deepEqual(hits, ['GET /rest/v1/profiles?select=*&limit=1']);
});

test('refuses the 51st request (request-cap) without sending', async () => {
  fs.writeFileSync(logPath(), Array.from({ length: 50 }, (_, i) => `t\tGET\tu${i}\t200\t1\n`).join(''));
  assert.deepEqual(await safeFetch(url(), { root, ...fast }), { refused: 'request-cap' });
  assert.equal(hits.length, 0);
  assert.equal(fs.readFileSync(logPath(), 'utf8').split('\n').filter(Boolean).length, 50);
});

test('the 50th request is allowed', async () => {
  fs.writeFileSync(logPath(), Array.from({ length: 49 }, (_, i) => `t\tGET\tu${i}\t200\t1\n`).join(''));
  assert.equal((await safeFetch(url(), { root, ...fast })).status, 200);
});

test('refusal order: no-scope before method, method before host, host before unbounded', async () => {
  fs.rmSync(path.join(root, '.vibe-secure'), { recursive: true });
  assert.deepEqual(await safeFetch('http://evil.example/rest/v1/x', { root, method: 'POST', ...fast }), { refused: 'no-scope' });
  writeScope([`127.0.0.1:${port}`]);
  assert.deepEqual(await safeFetch('http://evil.example/rest/v1/x', { root, method: 'POST', ...fast }), { refused: 'method-not-allowed' });
  assert.deepEqual(await safeFetch('http://evil.example/rest/v1/x', { root, ...fast }), { refused: 'host-not-in-scope' });
  fs.writeFileSync(logPath(), 'x\n'.repeat(50));
  assert.deepEqual(await safeFetch(url('/rest/v1/x'), { root, ...fast }), { refused: 'unbounded-read' });
});

test('in-scope GET: status, masked preview, masked headers, log line', async () => {
  const r = await safeFetch(url('/hi'), { root, ...fast });
  assert.equal(r.status, 200);
  assert.ok(!r.body_preview.includes(STRIPE));
  assert.ok(!r.body_preview.includes('alice@example.com'));
  assert.ok(r.body_preview.includes('sk_live_4f…a9'));
  assert.equal(r.headers['x-key'], 'sk_live_4f…a9');
  assert.equal(r.bytes, `hello alice@example.com ${STRIPE}`.length);
  const lines = fs.readFileSync(logPath(), 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  const [ts, method, u, status, bytes] = lines[0].split('\t');
  assert.ok(!Number.isNaN(Date.parse(ts)));
  assert.equal(method, 'GET');
  assert.equal(u, url('/hi'));
  assert.equal(status, '200');
  assert.equal(bytes, String(r.bytes));
});

test('HEAD works and sends no body read', async () => {
  const r = await safeFetch(url(), { root, method: 'HEAD', ...fast });
  assert.equal(r.status, 200);
  assert.equal(r.bytes, 0);
  assert.deepEqual(hits, ['HEAD /']);
});

test('request headers are sent but never logged', async () => {
  await safeFetch(url(), { root, headers: { apikey: 'SUPERSECRETANONKEY' }, ...fast });
  assert.ok(!fs.readFileSync(logPath(), 'utf8').includes('SUPERSECRETANONKEY'));
});

test('secrets in the URL are masked in the log', async () => {
  await safeFetch(url(`/x?key=${STRIPE}`), { root, ...fast });
  assert.ok(!fs.readFileSync(logPath(), 'utf8').includes(STRIPE));
});

test('off-scope redirect is reported, never followed', async () => {
  const r = await safeFetch(url('/redirect'), { root, ...fast });
  assert.equal(r.status, 302);
  assert.equal(r.redirect_location, 'http://evil.example/');
  assert.equal(hits.length, 1);
});

test('body preview is capped at 2048 chars; large bodies stop at 5 MB', async () => {
  const r = await safeFetch(url('/big'), { root, ...fast });
  assert.equal(r.body_preview.length, 2048);
  assert.ok(r.bytes >= 2048 && r.bytes <= 6 * 1024 * 1024);
  assert.ok(r.bytes <= 5 * 1024 * 1024 + 1024 * 1024); // stopped near the cap
});

test('timeout returns an error and logs ERR', async () => {
  const r = await safeFetch(url('/slow'), { root, delayMs: 0, timeoutMs: 150 });
  assert.equal(typeof r.error, 'string');
  const line = fs.readFileSync(logPath(), 'utf8').trim().split('\t');
  assert.equal(line[3], 'ERR');
});

test('waits delayMs before each request', async () => {
  const t = Date.now();
  await safeFetch(url(), { root, delayMs: 200, timeoutMs: 2000 });
  assert.ok(Date.now() - t >= 190);
});

test('response body is never written to disk', async () => {
  await safeFetch(url(), { root, ...fast });
  const files = fs.readdirSync(path.join(root, '.vibe-secure'));
  assert.deepEqual(files.sort(), ['live-requests.log', 'live-scope.json']);
});

// Async spawn: spawnSync would block the event loop that serves the test HTTP server.
const runCli = (args) => new Promise((resolve) => {
  execFile('node', [path.resolve('scripts/safe-fetch.mjs'), ...args], { encoding: 'utf8' },
    (err, stdout, stderr) => resolve({ status: err ? err.code : 0, stdout, stderr }));
});

test('CLI prints JSON; refusal exits 2', async () => {
  const ok = await runCli(['--root', root, '--header', 'apikey: abc', url('/cli')]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).status, 200);
  const refused = await runCli(['--root', root, '--method', 'POST', url()]);
  assert.equal(refused.status, 2);
  assert.deepEqual(JSON.parse(refused.stdout), { refused: 'method-not-allowed' });
  const bad = await runCli(['--root', root, 'http://evil.example/']);
  assert.equal(bad.status, 2);
});
