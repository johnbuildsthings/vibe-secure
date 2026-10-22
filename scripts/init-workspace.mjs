import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const IGNORE_LINE = '.vibe-secure/';
const STALE_FILES = ['merged.json', 'report.md', 'live-requests.log', 'live-scope.json'];

function ensureGitignore(root) {
  const file = join(root, '.gitignore');
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const lines = current.split(/\r?\n/).map((l) => l.trim());
  if (lines.includes('.vibe-secure/') || lines.includes('.vibe-secure')) return;
  const prefix = current === '' || current.endsWith('\n') ? '' : '\n';
  writeFileSync(file, `${current}${prefix}${IGNORE_LINE}\n`);
}

export function initWorkspace(root, { full = false } = {}) {
  const ws = join(root, '.vibe-secure');
  const findings = join(ws, 'findings');
  mkdirSync(findings, { recursive: true });
  ensureGitignore(root);
  if (full) {
    for (const f of readdirSync(findings)) {
      if (f.endsWith('.json')) rmSync(join(findings, f), { force: true });
    }
    for (const f of STALE_FILES) rmSync(join(ws, f), { force: true });
  }
}

function main(args) {
  const full = args.includes('--full');
  const [root] = args.filter((a) => a !== '--full');
  if (!root) {
    console.error('usage: node scripts/init-workspace.mjs <root> [--full]');
    return 1;
  }
  initWorkspace(root, { full });
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
