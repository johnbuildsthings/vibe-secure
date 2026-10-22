import fs from 'node:fs';
import path from 'node:path';
import { isMain } from './is-main.mjs';
import { maskText } from './mask.mjs';

const MAX_REQUESTS = 50;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const PREVIEW_CHARS = 2048;
const DEFAULT_DELAY_MS = 500;
const DEFAULT_TIMEOUT_MS = 10000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readScope(root) {
  try {
    const scope = JSON.parse(fs.readFileSync(path.join(root, '.vibe-secure', 'live-scope.json'), 'utf8'));
    if (scope && scope.confirmed_by_user === true && Array.isArray(scope.hosts)) return scope;
  } catch { /* missing or malformed */ }
  return null;
}

const OVERRIDE_HEADERS = ['x-http-method-override', 'x-http-method', 'x-method-override'];

function decodedPath(u) {
  let p = u.pathname;
  for (let i = 0; i < 5; i++) {
    const next = decodeURIComponent(p);
    if (next === p) break;
    p = next;
  }
  // Gateways merge duplicate slashes (and some treat backslashes as slashes).
  return p.toLowerCase().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

const exactly = (u, name, value) => {
  const all = u.searchParams.getAll(name);
  return all.length === 1 && all[0] === value;
};

function isUnbounded(u) {
  let path;
  try { path = decodedPath(u); } catch { return true; } // undecodable path: refuse
  const host = u.hostname.toLowerCase();
  if (path.includes('/rest/v') && !exactly(u, 'limit', '1')) return true;
  if (host === 'firestore.googleapis.com') {
    if (!exactly(u, 'pageSize', '1')) return true;
    if (u.searchParams.has('page_size') && !exactly(u, 'page_size', '1')) return true;
  }
  const isFirebaseDb = host.endsWith('firebaseio.com') || host.endsWith('firebasedatabase.app');
  if (isFirebaseDb && path.endsWith('.json') && !exactly(u, 'shallow', 'true')) return true;
  return false;
}

// URL for the log: no credentials, no fragment, every query value hidden, known secrets masked.
function logUrl(u) {
  const keys = [...u.searchParams.keys()].map((k) => `${encodeURIComponent(k)}=••••`);
  return maskText(`${u.origin}${u.pathname}${keys.length ? '?' + keys.join('&') : ''}`);
}

const LOCK_STALE_MS = 30000;
const LOCK_WAIT_MS = 60000;

// Exclusive lock so cap-check + reservation are atomic across concurrent calls.
async function withLock(dir, fn) {
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, 'live-requests.lock');
  const start = Date.now();
  for (;;) {
    try { fs.closeSync(fs.openSync(lock, 'wx')); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.unlinkSync(lock); } catch { /* raced */ }
      if (Date.now() - start > LOCK_WAIT_MS) throw new Error('could not acquire the request log lock');
      await sleep(5);
    }
  }
  try { return await fn(); } finally { try { fs.unlinkSync(lock); } catch { /* already gone */ } }
}

const readLines = (logPath) => {
  try { return fs.readFileSync(logPath, 'utf8').split('\n').filter((l) => l.length > 0); } catch { return []; }
};

// Reads the body fully (stopping at the cap) but keeps only the preview in memory.
async function readBody(response) {
  if (!response.body) return { preview: '', bytes: 0 };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let preview = '';
  let bytes = 0;
  while (bytes < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (preview.length < PREVIEW_CHARS) preview += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  return { preview: preview.slice(0, PREVIEW_CHARS), bytes };
}

export async function safeFetch(url, opts = {}) {
  const { root, headers = {}, delayMs = DEFAULT_DELAY_MS, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const method = opts.method ?? 'GET';

  const scope = readScope(root);
  if (!scope) return { refused: 'no-scope' };

  let u = null;
  try { u = new URL(url); } catch { /* handled below */ }
  const overrideHeader = Object.keys(headers).some((h) => OVERRIDE_HEADERS.includes(h.toLowerCase()));
  const overrideParam = u && [...u.searchParams.keys()].some((k) => k.toLowerCase() === '_method');
  if ((method !== 'GET' && method !== 'HEAD') || overrideHeader || overrideParam) {
    return { refused: 'method-not-allowed' };
  }

  if (!u) return { refused: 'host-not-in-scope' };
  const hosts = scope.hosts.filter((h) => typeof h === 'string').map((h) => h.toLowerCase());
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || !hosts.includes(u.host.toLowerCase())) {
    return { refused: 'host-not-in-scope' };
  }
  if (isUnbounded(u)) return { refused: 'unbounded-read' };

  const dir = path.join(root, '.vibe-secure');
  const logPath = path.join(dir, 'live-requests.log');
  const safeUrl = logUrl(u);

  // Claim a slot (and the inter-request delay) atomically before anything is sent.
  const reservation = await withLock(dir, async () => {
    const lines = readLines(logPath);
    if (lines.length >= MAX_REQUESTS) return null;
    const lastTs = Date.parse((lines.at(-1) ?? '').split('\t')[0]);
    await sleep(Number.isNaN(lastTs) ? delayMs : Math.max(0, lastTs + delayMs - Date.now()));
    // Request headers are deliberately never logged: they may carry keys.
    const prefix = `${new Date().toISOString()}\t${method}\t${safeUrl}\t`;
    fs.appendFileSync(logPath, `${prefix}PENDING\t0\n`);
    return prefix;
  });
  if (!reservation) return { refused: 'request-cap' };

  // Fills in the real status on the reserved line. The count of lines never changes.
  const complete = (status, bytes) => withLock(dir, async () => {
    const lines = readLines(logPath);
    const i = lines.lastIndexOf(`${reservation}PENDING\t0`);
    if (i >= 0) lines[i] = `${reservation}${status}\t${bytes}`;
    fs.writeFileSync(logPath, lines.join('\n') + '\n');
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(u, { method, headers, redirect: 'manual', signal: controller.signal });
    const { preview, bytes } = method === 'HEAD' ? { preview: '', bytes: 0 } : await readBody(response);
    const result = {
      status: response.status,
      headers: Object.fromEntries([...response.headers].map(([k, v]) => [k, maskText(v)])),
      body_preview: maskText(preview),
      bytes,
    };
    const location = response.headers.get('location');
    if (location) result.redirect_location = maskText(location);
    await complete(response.status, bytes);
    return result;
  } catch (err) {
    await complete('ERR', 0).catch(() => {});
    const raw = err.name === 'AbortError' ? `timeout after ${timeoutMs} ms` : String(err.message ?? err);
    // Never echo the raw URL (it could carry credentials or tokens).
    return { error: maskText(raw.split(url).join('<url>').split(u.href).join('<url>')) };
  } finally {
    clearTimeout(timer);
  }
}

function parseArgs(argv) {
  const args = { headers: {}, method: 'GET', url: null, root: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') args.root = argv[++i];
    else if (a === '--method') args.method = argv[++i];
    else if (a === '--header') {
      const h = argv[++i] ?? '';
      const idx = h.indexOf(':');
      if (idx > 0) args.headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim();
    } else args.url = a;
  }
  return args;
}

if (isMain(import.meta.url)) {
  const { root, method, headers, url } = parseArgs(process.argv.slice(2));
  if (!root || !url) {
    console.error('usage: safe-fetch.mjs --root <dir> [--method HEAD] [--header "Name: value"]... <url>');
    process.exit(1);
  }
  const result = await safeFetch(url, { root: path.resolve(root), method, headers });
  console.log(JSON.stringify(result));
  process.exit(result.refused ? 2 : result.error ? 1 : 0);
}
