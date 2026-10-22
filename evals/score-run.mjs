// Scores the findings files a headless audit run produced against a fixture's expectations.
//   node evals/score-run.mjs --expected <file> [--expected <file>...] --findings <dir> [--area <area>] [--invert]
// Exit 0 on pass, 1 on fail.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateFindingsFile, severityRank, SEVERITIES } from '../scripts/validate-findings.mjs';

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

  // Skills always write a findings file per audited area (`findings: []` when clean).
  if (dirMissing || docs.length === 0) invalid.push('no findings files');
  const validDocs = [];
  docs.forEach((d, i) => {
    const errs = validateFindingsFile(d);
    for (const e of errs) invalid.push(`findings file ${i + 1}: ${e}`);
    if (!errs.length) validDocs.push(d);
  });
  const audited = (a) => validDocs.some((d) => d.area === a);
  if (area && docs.length && !audited(area)) invalid.push(`no valid findings file for area ${area}`);

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

  if (invert) {
    for (const a of new Set(gating.map((e) => e.area))) {
      if (!audited(a)) invalid.push(`NOT AUDITED: ${a}`);
    }
  }
  if (!area && !expected.baseline && gating.length === 0) {
    invalid.push('the expectations have no gating (critical/high) entries, so nothing would be checked');
  }

  const pass = invalid.length === 0 && missed.length === 0 && false_positives.length === 0;
  return { pass, missed, false_positives, invalid, info };
}

export function validateExpected(d, name = 'expected file') {
  const bad = (m) => { throw new Error(`${name}: ${m}`); };
  if (d === null || typeof d !== 'object' || Array.isArray(d)) bad('must be a JSON object');
  if (typeof d.baseline !== 'boolean') bad('baseline must be true or false');
  if (!Array.isArray(d.expected)) bad('expected must be an array');
  if ('ignore_checks' in d && !(Array.isArray(d.ignore_checks) && d.ignore_checks.every((x) => typeof x === 'string'))) {
    bad('ignore_checks must be an array of strings');
  }
  d.expected.forEach((e, i) => {
    if (e === null || typeof e !== 'object') bad(`expected[${i}] must be an object`);
    if (typeof e.check !== 'string' || !e.check) bad(`expected[${i}].check must be a non-empty string`);
    if (typeof e.area !== 'string' || !e.area) bad(`expected[${i}].area must be a non-empty string`);
    if (!SEVERITIES.includes(e.min_severity)) bad(`expected[${i}].min_severity must be one of ${SEVERITIES.join(', ')}`);
    if ('subject' in e && typeof e.subject !== 'string') bad(`expected[${i}].subject must be a string`);
  });
  return d;
}

export function loadExpected(files) {
  const merged = { baseline: false, ignore_checks: [], expected: [] };
  for (const file of files) {
    const d = validateExpected(JSON.parse(readFileSync(file, 'utf8')), file);
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
  let expected;
  try {
    expected = loadExpected(o.expected);
  } catch (e) {
    console.error(`bad expectations: ${e.message}`);
    return 1;
  }
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
