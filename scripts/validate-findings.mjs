import { readFileSync } from 'node:fs';
import { isMain } from './is-main.mjs';

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'unverified'];
const STATUSES = ['open', 'fixed', 'skipped', 'awaiting-user'];
const MODES = ['audit', 'verify'];

export function severityRank(s) {
  const i = SEVERITIES.indexOf(s);
  return i === -1 ? -1 : SEVERITIES.length - 1 - i;
}

function isServiceRoleJwt(match) {
  try {
    const payload = JSON.parse(Buffer.from(match.split('.')[1], 'base64url').toString('utf8'));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

// `test`, when present, must also pass for a regex match to count.
export const SECRET_PATTERNS = [
  { name: 'stripe-key', regex: /(?<![A-Za-z0-9_-])sk_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { name: 'stripe-restricted-key', regex: /(?<![A-Za-z0-9_-])rk_live_[A-Za-z0-9]{16,}/g },
  { name: 'anthropic-key', regex: /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'openai-key', regex: /(?<![A-Za-z0-9_-])sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: 'google-api-key', regex: /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}/g },
  { name: 'aws-access-key', regex: /(?<![A-Za-z0-9_-])AKIA[0-9A-Z]{16}/g },
  { name: 'supabase-service-role-jwt', regex: /(?<![A-Za-z0-9_-])eyJ[\w-]+\.[\w-]+\.[\w-]+/g, test: isServiceRoleJwt },
];

// Returns the names of secret patterns found unmasked in `text`.
export function findUnmaskedSecrets(text) {
  if (typeof text !== 'string') return [];
  const names = new Set();
  for (const { name, regex, test } of SECRET_PATTERNS) {
    for (const m of text.matchAll(new RegExp(regex.source, regex.flags))) {
      if (m[0].includes('…')) continue;
      if (test && !test(m[0])) continue;
      names.add(name);
    }
  }
  return [...names];
}

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function validateEvidence(e, path) {
  if (!isObj(e)) return [`${path} must be an object`];
  if ('file' in e) {
    const errors = [];
    if (!isStr(e.file)) errors.push(`${path}.file must be a non-empty string`);
    if (!Number.isInteger(e.line)) errors.push(`${path}.line must be a number`);
    return errors;
  }
  if ('url' in e) {
    const errors = [];
    if (!isStr(e.url)) errors.push(`${path}.url must be a non-empty string`);
    if (!Number.isInteger(e.status)) errors.push(`${path}.status must be a number`);
    if (!isStr(e.summary)) errors.push(`${path}.summary must be a non-empty string`);
    return errors;
  }
  return [`${path} needs {file, line} or {url, status, summary}`];
}

export function validateFinding(f) {
  if (!isObj(f)) return ['finding must be an object'];
  const errors = [];
  for (const k of ['id', 'check', 'subject', 'area', 'owasp', 'title', 'impact', 'fix_plan']) {
    if (!isStr(f[k])) errors.push(`${k} must be a non-empty string`);
  }
  if (isStr(f.id) && !/^[a-z-]+-\d+$/.test(f.id)) errors.push('id must match ^[a-z-]+-\\d+$');
  if (!SEVERITIES.includes(f.severity)) errors.push(`severity must be one of ${SEVERITIES.join(', ')}`);
  if (!STATUSES.includes(f.status)) errors.push(`status must be one of ${STATUSES.join(', ')}`);

  if (!Array.isArray(f.evidence)) {
    errors.push('evidence must be an array');
  } else {
    if (f.evidence.length === 0 && f.severity !== 'unverified') {
      errors.push('evidence is empty: no proof, no finding (only unverified findings may have none)');
    }
    f.evidence.forEach((e, i) => errors.push(...validateEvidence(e, `evidence[${i}]`)));
  }

  if (!isObj(f.fix_risk)) {
    errors.push('fix_risk must be an object');
  } else {
    if (!['low', 'high'].includes(f.fix_risk.level)) errors.push('fix_risk.level must be "low" or "high"');
    if (typeof f.fix_risk.may_break !== 'string') errors.push('fix_risk.may_break must be a string');
  }

  if (!Array.isArray(f.manual_steps) || !f.manual_steps.every((s) => typeof s === 'string')) {
    errors.push('manual_steps must be an array of strings');
  }

  const texts = { title: f.title, impact: f.impact, fix_plan: f.fix_plan, subject: f.subject };
  if (Array.isArray(f.manual_steps)) f.manual_steps.forEach((s, i) => { texts[`manual_steps[${i}]`] = s; });
  if (Array.isArray(f.evidence)) {
    f.evidence.forEach((e, i) => { if (isObj(e)) texts[`evidence[${i}].summary`] = e.summary; });
  }
  for (const [field, text] of Object.entries(texts)) {
    const found = findUnmaskedSecrets(text);
    if (found.length) errors.push(`${field} contains an unmasked secret (${found.join(', ')})`);
  }
  return errors;
}

export function validateFindingsFile(doc) {
  if (!isObj(doc)) return ['findings file must be an object'];
  const errors = [];
  if (!isStr(doc.area)) errors.push('area must be a non-empty string');
  if (!isStr(doc.generated_at) || Number.isNaN(Date.parse(doc.generated_at))) {
    errors.push('generated_at must be an ISO date string');
  }
  if (!MODES.includes(doc.mode)) errors.push(`mode must be one of ${MODES.join(', ')}`);
  if (!Array.isArray(doc.findings)) {
    errors.push('findings must be an array');
  } else {
    doc.findings.forEach((f, i) => {
      for (const e of validateFinding(f)) errors.push(`findings[${i}]: ${e}`);
    });
  }
  return errors;
}

function main(files) {
  if (files.length === 0) {
    console.error('usage: node scripts/validate-findings.mjs <file.json>...');
    return 1;
  }
  let bad = false;
  for (const file of files) {
    let errors;
    try {
      errors = validateFindingsFile(JSON.parse(readFileSync(file, 'utf8')));
    } catch (e) {
      errors = [`cannot read or parse: ${e.message}`];
    }
    for (const e of errors) console.error(`${file}: ${e}`);
    if (errors.length) bad = true;
  }
  return bad ? 1 : 0;
}

if (isMain(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
