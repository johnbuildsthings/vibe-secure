// Smoke test: exits 0 if this app's features are intact.
// Python app: runs `python3 -m py_compile` on every .py file when python3 exists,
// otherwise only asserts the files exist. Also asserts the `search` route function remains.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pyFiles = readdirSync(root).filter((f) => f.endsWith('.py'));
const problems = [];

if (!pyFiles.includes('app.py')) problems.push('missing app.py');

let havePython = true;
try {
  execFileSync('python3', ['--version'], { stdio: 'pipe' });
} catch {
  havePython = false;
}
for (const f of pyFiles) {
  if (!existsSync(join(root, f))) problems.push(`missing ${f}`);
  else if (havePython) {
    try {
      execFileSync('python3', ['-m', 'py_compile', join(root, f)], { stdio: 'pipe', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    } catch (err) {
      problems.push(`syntax error in ${f}: ${err.stderr}`);
    }
  }
}
if (pyFiles.includes('app.py') && !/^def search\(/m.test(readFileSync(join(root, 'app.py'), 'utf8'))) {
  problems.push('app.py: search() is gone');
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('smoke ok');
