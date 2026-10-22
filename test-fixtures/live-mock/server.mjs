// Stand-in for a deployed app plus Supabase's PostgREST, for live-probe tests.
//   node test-fixtures/live-mock/server.mjs --app-port 4100 --db-port 4101 --violations <file>
// Optional: --fixture <name> (default nextjs-supabase-leaky) picks the .env the anon key is read from.
// Port 0 picks a free port. Once listening it prints one JSON line: {"app":<port>,"db":<port>}.
// Any non-GET/HEAD request, and any /rest/v1/ request without limit=1, is appended to the
// violations file as a JSON line and answered 405.
import { createServer } from 'node:http';
import { readFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { appPort: 4100, dbPort: 4101, violations: null, fixture: 'nextjs-supabase-leaky' };
  for (let i = 0; i < argv.length; i += 2) {
    const v = argv[i + 1];
    if (argv[i] === '--app-port') out.appPort = Number(v);
    else if (argv[i] === '--db-port') out.dbPort = Number(v);
    else if (argv[i] === '--violations') out.violations = v;
    else if (argv[i] === '--fixture') out.fixture = v;
    else throw new Error(`unknown flag ${argv[i]}`);
  }
  if (!out.violations) throw new Error('--violations <file> is required');
  return out;
}

export function startMock({ appPort, dbPort, violations, fixture }) {
  const envText = readFileSync(join(HERE, '..', fixture, '.env'), 'utf8');
  const anonKey = envText.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)$/m)[1].trim();

  const record = (req, why) =>
    appendFileSync(violations, JSON.stringify({ method: req.method, url: req.url, why }) + '\n');
  const refuse = (req, res, why) => {
    record(req, why);
    res.writeHead(405, { Allow: 'GET, HEAD' }).end('method or request not allowed in tests\n');
  };
  const readOnly = (req) => req.method === 'GET' || req.method === 'HEAD';

  const app = createServer((req, res) => {
    if (!readOnly(req)) return refuse(req, res, 'non-GET/HEAD');
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<!doctype html><html><head><title>Leaky Shop</title></head><body><div id="root"></div></body></html>');
    }
    if (pathname === '/.env') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(envText);
    }
    if (pathname === '/_next/static/chunks/main.js.map') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"version":3,"sources":["webpack://app/./lib/supabase.js"],"mappings":""}');
    }
    if (pathname === '/api/users') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify([{ id: 1, email: 'user@example.com' }]));
    }
    res.writeHead(404).end('not found\n');
  });

  const db = createServer((req, res) => {
    if (!readOnly(req)) return refuse(req, res, 'non-GET/HEAD');
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/rest/v1/')) return res.writeHead(404).end('not found\n');
    if (url.searchParams.get('limit') !== '1') return refuse(req, res, 'rest request without limit=1');
    if (req.headers.apikey !== anonKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end('{"message":"Invalid API key"}');
    }
    if (url.pathname !== '/rest/v1/profiles') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end('{"message":"relation does not exist"}');
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Range': '0-0/1204' });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify([{ id: '00000000-0000-0000-0000-000000000001', name: 'Sample User', email: 'user@example.com' }]));
  });

  return new Promise((resolve, reject) => {
    app.once('error', reject);
    db.once('error', reject);
    app.listen(appPort, '127.0.0.1', () => {
      db.listen(dbPort, '127.0.0.1', () => {
        resolve({
          appPort: app.address().port,
          dbPort: db.address().port,
          close: () => { app.close(); db.close(); },
        });
      });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { appPort, dbPort, close } = await startMock(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify({ app: appPort, db: dbPort }));
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { close(); process.exit(0); });
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
