import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from './is-main.mjs';
import { severityRank, validateFindingsFile } from './validate-findings.mjs';

const COUNTED = ['critical', 'high', 'medium', 'low'];

// A merged finding is `fixed` only when every copy is fixed.
const STATUS_PRECEDENCE = ['awaiting-user', 'open', 'skipped', 'fixed'];

const groupKey = (f) => `${f.check}\u0000${String(f.subject ?? '').trim().toLowerCase()}`;

function mergeGroup(group) {
  const merged = structuredClone(group[0]);
  const seen = new Set(merged.evidence.map((e) => JSON.stringify(e)));
  for (const f of group.slice(1)) {
    if (severityRank(f.severity) > severityRank(merged.severity)) merged.severity = f.severity;
    for (const e of f.evidence) {
      const key = JSON.stringify(e);
      if (!seen.has(key)) {
        seen.add(key);
        merged.evidence.push(structuredClone(e));
      }
    }
    for (const s of f.manual_steps) {
      if (!merged.manual_steps.includes(s)) merged.manual_steps.push(s);
    }
    if (f.fix_risk.level === 'high' && merged.fix_risk.level !== 'high') {
      merged.fix_risk = structuredClone(f.fix_risk);
    }
  }
  merged.status = STATUS_PRECEDENCE.find((s) => group.some((f) => f.status === s)) ?? merged.status;
  merged.areas = [...new Set(group.map((f) => f.area))];
  return merged;
}

const byRank = (a, b) =>
  severityRank(b.severity) - severityRank(a.severity) ||
  a.area.localeCompare(b.area) ||
  a.id.localeCompare(b.id);

export function mergeFindings(docs) {
  const groups = new Map();
  for (const d of docs) {
    for (const f of d.findings) {
      const key = groupKey(f);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(f);
    }
  }
  const all = [...groups.values()].map(mergeGroup).sort(byRank);
  const findings = all.filter((f) => f.severity !== 'unverified');
  const worth_a_look = all.filter((f) => f.severity === 'unverified');
  const counts = Object.fromEntries(COUNTED.map((s) => [s, 0]));
  for (const f of findings) counts[f.severity] += 1;
  return { findings, worth_a_look, counts };
}

function main(args) {
  const [root] = args;
  if (!root) {
    console.error('usage: node scripts/merge-findings.mjs <root>');
    return 1;
  }
  const ws = join(root, '.vibe-secure');
  const dir = join(ws, 'findings');
  const docs = [];
  const skipped_files = [];
  const names = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  for (const name of names) {
    let doc;
    let errors;
    try {
      doc = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      errors = validateFindingsFile(doc);
    } catch (e) {
      errors = [`cannot read or parse: ${e.message}`];
    }
    if (errors.length) {
      skipped_files.push(name);
      console.error(`warning: skipping ${name}`);
      for (const e of errors) console.error(`  ${name}: ${e}`);
    } else {
      docs.push(doc);
    }
  }
  mkdirSync(ws, { recursive: true });
  const out = { generated_at: new Date().toISOString(), ...mergeFindings(docs), skipped_files };
  writeFileSync(join(ws, 'merged.json'), `${JSON.stringify(out, null, 2)}\n`);
  return 0;
}

if (isMain(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
