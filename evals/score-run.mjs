// Scores the findings files a headless audit run produced against a fixture's expectations.
//   node evals/score-run.mjs --expected <file> [--expected <file>...] --findings <dir> [--area <area>] [--invert]
// Exit 0 on pass, 1 on fail.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateFindingsFile, severityRank } from '../scripts/validate-findings.mjs';

const GATING = severityRank('high');
const GIT_HISTORY = 'secrets.key-in-git-history';

const matches = (e, f) =>
  f.check === e.check &&
  (!e.subject || String(f.subject ?? '').toLowerCase().includes(e.subject.toLowerCase()));

// expected: {baseline, ignore_checks, expected[]}. docs: parsed findings files.
// opts: area (filter), invert (fix re-run: gating expectations must be gone), dirMissing (findings dir absent).
export function scoreRun(expected, docs, { area, invert = false, dirMissing = false } = {}) {
  const invalid = [];
  const info = [];
  const missed = [];
  const false_positives = [];

  if (dirMissing || (docs.length === 0 && !expected.baseline)) invalid.push('no findings files');
  docs.forEach((d, i) => {
    for (const e of validateFindingsFile(d)) invalid.push(`findings file ${i + 1}: ${e}`);
  });

  const inArea = (x) => !area || x.area === area;
  const findings = docs.flatMap((d) => (Array.isArray(d?.findings) ? d.findings : [])).filter(inArea);
  const wanted = (expected.expected ?? []).filter(inArea);
  const gating = wanted.filter((e) => severityRank(e.min_severity) >= GATING);

  for (const e of wanted) {
    if (severityRank(e.min_severity) >= GATING) continue;
    const hit = findings.some((f) => matches(e, f) && severityRank(f.severity) >= severityRank(e.min_severity));
    if (!invert && !hit) info.push(`not gating, not found: ${e.check} (${e.subject ?? '*'}) >= ${e.min_severity}`);
  }

  if (invert) {
    for (const e of gating) {
      const hits = findings.filter((f) => matches(e, f));
      if (e.check === GIT_HISTORY) {
        const ok = hits.some((f) => f.status === 'awaiting-user') && !hits.some((f) => f.status === 'fixed');
        if (!ok) {
          missed.push(e);
          info.push(`${e.check} must be awaiting-user, found: ${hits.map((f) => f.status).join(', ') || 'no finding'}`);
        }
      } else if (hits.length) {
        missed.push(e);
        info.push(`${e.check} (${e.subject ?? '*'}) is still reported after the fix`);
      }
    }
  } else {
    for (const e of gating) {
      const hit = findings.some((f) => matches(e, f) && severityRank(f.severity) >= severityRank(e.min_severity));
      if (!hit) missed.push(e);
    }
    if (expected.baseline) {
      const ignore = new Set(expected.ignore_checks ?? []);
      for (const f of findings) {
        if (severityRank(f.severity) >= GATING && !ignore.has(f.check)) false_positives.push(f);
      }
    }
  }

  if (gating.length === 0 && !expected.baseline) {
    info.push(`NO GATING EXPECTATIONS for area ${area ?? '(any)'}: nothing was checked`);
  }

  const pass = invalid.length === 0 && missed.length === 0 && false_positives.length === 0;
  return { pass, missed, false_positives, invalid, info };
}

export function loadExpected(files) {
  const merged = { baseline: false, ignore_checks: [], expected: [] };
  for (const file of files) {
    const d = JSON.parse(readFileSync(file, 'utf8'));
    merged.baseline ||= d.baseline === true;
    merged.ignore_checks = [...new Set([...merged.ignore_checks, ...(d.ignore_checks ?? [])])];
    merged.expected.push(...(d.expected ?? []));
  }
  return merged;
}

export function loadFindingsDir(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return { docs: [], dirMissing: true };
  const docs = readdirSync(dir).filter((n) => n.endsWith('.json')).sort().map((n) => {
    try {
      return JSON.parse(readFileSync(join(dir, n), 'utf8'));
    } catch (e) {
      return { unreadable: `${n}: ${e.message}` };
    }
  });
  return { docs, dirMissing: false };
}

function parseArgs(argv) {
  const o = { expected: [], findings: null, area: undefined, invert: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--expected') o.expected.push(argv[++i]);
    else if (a === '--findings') o.findings = argv[++i];
    else if (a === '--area') o.area = argv[++i];
    else if (a === '--invert') o.invert = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.expected.length || !o.findings || o.expected.some((x) => !x) ) {
    throw new Error('usage: node evals/score-run.mjs --expected <file> [--expected <file>...] --findings <dir> [--area <area>] [--invert]');
  }
  return o;
}

function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.error(e.message);
    return 1;
  }
  const expected = loadExpected(o.expected);
  const { docs, dirMissing } = loadFindingsDir(o.findings);
  const r = scoreRun(expected, docs, { area: o.area, invert: o.invert, dirMissing });
  const label = o.invert ? 'after-fix' : 'report';
  console.log(`Eval (${label})${o.area ? ` area=${o.area}` : ''}: ${r.pass ? 'PASS' : 'FAIL'}`);
  const rows = [
    ...r.missed.map((e) => ['MISSED', e.check, e.subject ?? '*', e.min_severity]),
    ...r.false_positives.map((f) => ['FALSE POSITIVE', f.check, f.subject, f.severity]),
  ];
  if (rows.length) {
    console.log('result'.padEnd(15) + 'check'.padEnd(34) + 'subject'.padEnd(28) + 'severity');
    for (const row of rows) console.log(row[0].padEnd(15) + row[1].padEnd(34) + String(row[2]).padEnd(28) + row[3]);
  }
  for (const x of r.invalid) console.log(`INVALID: ${x}`);
  for (const x of r.info) console.log(`info: ${x}`);
  return r.pass ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
