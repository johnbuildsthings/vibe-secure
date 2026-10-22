// Every script CLI must run when invoked through a symlinked path (macOS /var → /private/var,
// symlinked plugin or home dirs). A guard comparing import.meta.url with the unresolved
// argv path silently skips main(), so the validator would "pass" without validating.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CLIS = [
  'scripts/validate-findings.mjs',
  'scripts/detect-stack.mjs',
  'scripts/init-workspace.mjs',
  'scripts/merge-findings.mjs',
  'scripts/safe-fetch.mjs',
  'evals/score-run.mjs',
];

function symlinkedCopy() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'vs-symlink-')));
  const real = join(base, 'real');
  mkdirSync(real);
  cpSync(join(REPO, 'scripts'), join(real, 'scripts'), { recursive: true });
  cpSync(join(REPO, 'evals', 'score-run.mjs'), join(real, 'evals', 'score-run.mjs'));
  const link = join(base, 'link');
  symlinkSync(real, link, 'dir');
  return link;
}

const link = symlinkedCopy();
for (const cli of CLIS) {
  test(`${cli} runs its CLI when invoked through a symlink`, () => {
    const r = spawnSync(process.execPath, [join(link, cli)], { encoding: 'utf8' });
    assert.notEqual(r.status, 0, `expected a usage error, got exit ${r.status} with no output`);
    assert.match(r.stderr, /usage/i);
  });
}

test('modules still import under node -e, where argv[1] is not a file', () => {
  const mask = join(link, 'scripts', 'mask.mjs');
  const code = `import(${JSON.stringify(mask)}).then((m) => console.log(m.maskSecret(process.argv[1])))`;
  const withArg = spawnSync(process.execPath, ['-e', code, 'sk_live_HISTFAKEFAKEFAKEFAKEFAKE'], { encoding: 'utf8' });
  assert.equal(withArg.status, 0, withArg.stderr);
  assert.equal(withArg.stdout.trim(), 'sk_live_HI…KE');
  const noArg = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(mask)}).then(() => console.log('ok'))`], { encoding: 'utf8' });
  assert.equal(noArg.status, 0, noArg.stderr);
});
