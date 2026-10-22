import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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

function countLogLines(logPath) {
  try {
    return fs.readFileSync(logPath, 'utf8').split('\n').filter((l) => l.length > 0).length;
  } catch { return 0; }
}

function isUnbounded(u) {
  const host = u.hostname.toLowerCase();
  const p = u.searchParams;
  if (u.pathname.includes('/rest/v1/') && p.get('limit') !== '1') return true;
  if (host === 'firestore.googleapis.com' && p.get('pageSize') !== '1') return true;
  const isFirebaseDb = host.endsWith('firebaseio.com') || host.endsWith('firebasedatabase.app');
  if (isFirebaseDb && u.pathname.endsWith('.json') && p.get('shallow') !== 'true') return true;
  return false;
}

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
  if (method !== 'GET' && method !== 'HEAD') return { refused: 'method-not-allowed' };

  let u;
  try { u = new URL(url); } catch { return { refused: 'host-not-in-scope' }; }
  const hosts = scope.hosts.filter((h) => typeof h === 'string').map((h) => h.toLowerCase());
  if (!['http:', 'https:'].includes(u.protocol) || !hosts.includes(u.host.toLowerCase())) {
    return { refused: 'host-not-in-scope' };
  }
  if (isUnbounded(u)) return { refused: 'unbounded-read' };

  const dir = path.join(root, '.vibe-secure');
  const logPath = path.join(dir, 'live-requests.log');
  if (countLogLines(logPath) >= MAX_REQUESTS) return { refused: 'request-cap' };

  await sleep(delayMs);

  const log = (status, bytes) => {
    fs.mkdirSync(dir, { recursive: true });
    // Request headers are deliberately never logged: they may carry keys.
    fs.appendFileSync(logPath, `${new Date().toISOString()}\t${method}\t${maskText(url)}\t${status}\t${bytes}\n`);
  };

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
    log(response.status, bytes);
    return result;
  } catch (err) {
    log('ERR', 0);
    return { error: err.name === 'AbortError' ? `timeout after ${timeoutMs} ms` : String(err.message ?? err) };
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { root, method, headers, url } = parseArgs(process.argv.slice(2));
  if (!root || !url) {
    console.error('usage: safe-fetch.mjs --root <dir> [--method HEAD] [--header "Name: value"]... <url>');
    process.exit(1);
  }
  const result = await safeFetch(url, { root: path.resolve(root), method, headers });
  console.log(JSON.stringify(result));
  process.exit(result.refused ? 2 : result.error ? 1 : 0);
}
