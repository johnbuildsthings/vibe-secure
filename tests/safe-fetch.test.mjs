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
const readLogLines = () => fs.readFileSync(logPath(), 'utf8').split('\n').filter(Boolean);
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
    'https://p.firebaseio.com/users.json/',
    'https://p.firebaseio.com/users.json//',
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

const jwt = (payload) => [{ alg: 'HS256', typ: 'JWT' }, payload]
  .map((o) => Buffer.from(JSON.stringify(o)).toString('base64url')).join('.') + '.c2lnbmF0dXJl';
const SERVICE_JWT = jwt({ iss: 'supabase', ref: 'abcd', role: 'service_role' });
const ANON_JWT = jwt({ iss: 'supabase', ref: 'abcd', role: 'anon' });
const SB_SECRET = 'sb_secret_' + 'Q'.repeat(28) + 'z9';
const SB_PUBLISHABLE = 'sb_publishable_' + 'Q'.repeat(28) + 'z9';

test('refuses secret credentials in headers or query (secret-credential), before using a slot', async () => {
  const cases = [
    { headers: { apikey: SERVICE_JWT } },
    { headers: { Authorization: `Bearer ${SERVICE_JWT}` } },
    { headers: { apikey: SB_SECRET } },
    { headers: { Authorization: `Bearer ${STRIPE}` } },
    { path: `/rest/v1/p?limit=1&apikey=${SERVICE_JWT}` },
    { path: `/rest/v1/p?limit=1&apikey=${SB_SECRET}` },
    { path: `/x?key=${encodeURIComponent(STRIPE)}` },
  ];
  for (const c of cases) {
    const r = await safeFetch(url(c.path ?? '/rest/v1/p?limit=1'), { root, headers: c.headers ?? {}, ...fast });
    assert.deepEqual(r, { refused: 'secret-credential' }, JSON.stringify(c));
  }
  assert.equal(hits.length, 0);
  assert.equal(fs.existsSync(logPath()), false);
});

test('public credentials are allowed: Supabase anon JWT and sb_publishable_ key', async () => {
  const anon = await safeFetch(url('/rest/v1/p?limit=1'), {
    root, method: 'HEAD', headers: { apikey: ANON_JWT, Authorization: `Bearer ${ANON_JWT}`, Prefer: 'count=exact' }, ...fast });
  assert.equal(anon.status, 200);
  const pub = await safeFetch(url('/rest/v1/p?limit=1'), { root, method: 'HEAD', headers: { apikey: SB_PUBLISHABLE }, ...fast });
  assert.equal(pub.status, 200);
  const q = await safeFetch(url(`/rest/v1/p?limit=1&apikey=${SB_PUBLISHABLE}`), { root, ...fast });
  assert.equal(q.status, 200);
  assert.equal(hits.length, 3);
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

test('secrets in the URL path are masked in the log', async () => {
  // (A secret in a query value or header is refused outright: see secret-credential.)
  await safeFetch(url(`/x/${STRIPE}`), { root, ...fast });
  assert.equal(readLogLines().length, 1);
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

test('parallel calls at 49 lines send exactly 1 request', async () => {
  fs.writeFileSync(logPath(), Array.from({ length: 49 }, (_, i) => `t\tGET\tu${i}\t200\t1\n`).join(''));
  const results = await Promise.all(Array.from({ length: 10 }, () => safeFetch(url('/p'), { root, delayMs: 0, timeoutMs: 2000 })));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.refused === 'request-cap').length, 9);
  assert.equal(hits.length, 1);
  assert.equal(readLogLines().length, 50);
});

test('parallel calls are spaced by the delay', async () => {
  // The log's reservation timestamps are taken after the wait, so they show the spacing
  // without network jitter (server arrival times can bunch up under load).
  await Promise.all([1, 2, 3].map(() => safeFetch(url('/'), { root, delayMs: 150, timeoutMs: 2000 })));
  const stamps = readLogLines().map((l) => Date.parse(l.split('\t')[0]));
  assert.equal(stamps.length, 3);
  assert.equal(hits.length, 3);
  // 2 ms of slack: a timer may fire up to a millisecond early, and stamps are whole milliseconds.
  assert.ok(stamps[1] - stamps[0] >= 148 && stamps[2] - stamps[1] >= 148, JSON.stringify(stamps));
});

test('encoded / differently-cased / duplicated-param bypasses are refused', async () => {
  writeScope([`127.0.0.1:${port}`, 'firestore.googleapis.com', 'p.firebaseio.com']);
  const bad = [
    url('/rest/v%31/profiles'),
    url('/REST/V1/p'),
    url('/rest//v1/p'),
    url('/rest/v1//p'),
    url('//rest///v1/p'),
    url('/rest%2F%2Fv1/p'),
    url('/rest/v1/p?limit=1&limit=1000'),
    url('/rest/v1/p?limit=1000&limit=1'),
    url('/rest/%2576%31/p'),
    'https://firestore.googleapis.com/v1/x?pageSize=1&pageSize=100',
    'https://firestore.googleapis.com/v1/x?pageSize=1&page_size=100',
    'https://p.firebaseio.com/users.json?shallow=true&shallow=false',
    'https://p.firebaseio.com/USERS.JSON',
  ];
  for (const u of bad) assert.deepEqual(await safeFetch(u, { root, ...fast }), { refused: 'unbounded-read' }, u);
  assert.equal(hits.length, 0);
});

test('method-override headers and _method param are refused', async () => {
  for (const h of ['X-HTTP-Method-Override', 'x-http-method', 'X-Method-Override']) {
    assert.deepEqual(await safeFetch(url(), { root, headers: { [h]: 'DELETE' }, ...fast }), { refused: 'method-not-allowed' }, h);
  }
  assert.deepEqual(await safeFetch(url('/?_method=DELETE'), { root, ...fast }), { refused: 'method-not-allowed' });
  assert.deepEqual(await safeFetch(url('/?_METHOD=DELETE'), { root, ...fast }), { refused: 'method-not-allowed' });
  assert.equal(hits.length, 0);
});

test('URLs with credentials are refused before using a slot, and never logged', async () => {
  const r = await safeFetch(`http://admin:hunter2@127.0.0.1:${port}/`, { root, ...fast });
  assert.deepEqual(r, { refused: 'host-not-in-scope' });
  assert.equal(hits.length, 0);
  assert.ok(!fs.existsSync(logPath()));
});

test('query values are masked in the log; no tabs/newlines can forge lines', async () => {
  await safeFetch(url('/x?auth=opaqueTOKEN123&b=%0Aforged%09line'), { root, ...fast });
  const raw = fs.readFileSync(logPath(), 'utf8');
  assert.ok(!raw.includes('opaqueTOKEN123'));
  assert.ok(!raw.includes('forged'));
  assert.ok(raw.includes('?auth=••••&b=••••'));
  assert.equal(readLogLines().length, 1);
  assert.equal(readLogLines()[0].split('\t').length, 5);
});

test('network errors do not echo the raw URL', async () => {
  const dead = http.createServer(); await new Promise((r) => dead.listen(0, '127.0.0.1', r));
  const dp = dead.address().port; await new Promise((r) => dead.close(r));
  writeScope([`127.0.0.1:${dp}`]);
  const r = await safeFetch(`http://127.0.0.1:${dp}/?token=abc123secret`, { root, ...fast });
  assert.equal(typeof r.error, 'string');
  assert.ok(!r.error.includes('abc123secret'));
  assert.equal(readLogLines()[0].split('\t')[3], 'ERR');
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
