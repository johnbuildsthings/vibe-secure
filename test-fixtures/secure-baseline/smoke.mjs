// Smoke test: exits 0 if this app's features are intact.
// Syntax-checks every .js/.mjs file and asserts these named exports still exist:
//   lib/supabase-public.js -> supabase
//   lib/supabase-admin.js -> admin, getUser
//   lib/escape.js -> escapeHtml
//   app/api/checkout/route.js -> POST
//   app/api/stripe/webhook/route.js -> POST
//   app/api/chat/route.js -> POST
//   app/components/Bio.jsx -> Bio
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const EXPORTS = {
  'lib/supabase-public.js': ['supabase'],
  'lib/supabase-admin.js': ['admin', 'getUser'],
  'lib/escape.js': ['escapeHtml'],
  'app/api/checkout/route.js': ['POST'],
  'app/api/stripe/webhook/route.js': ['POST'],
  'app/api/chat/route.js': ['POST'],
  'app/components/Bio.jsx': ['Bio'],
};

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (['node_modules', '.git', '.next'].includes(e.name)) return [];
    const p = join(dir, e.name);
    if (e.isDirectory()) return jsFiles(p);
    return /\.(js|mjs)$/.test(e.name) && e.name !== 'smoke.mjs' ? [p] : [];
  });
}

const problems = [];
for (const f of jsFiles(root)) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    problems.push(`syntax error in ${f}: ${err.stderr}`);
  }
}
for (const [file, names] of Object.entries(EXPORTS)) {
  let src = '';
  try {
    src = readFileSync(join(root, file), 'utf8');
  } catch {
    problems.push(`missing file ${file}`);
    continue;
  }
  for (const n of names) {
    const re = new RegExp(`export (async )?function ${n}\\b|export const ${n}\\b|export default ${n}\\b`);
    if (!re.test(src)) problems.push(`${file}: export ${n} is gone`);
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('smoke ok');
