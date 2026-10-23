import { SECRET_PATTERNS } from './validate-findings.mjs';

// Longest first, so `sk-proj-` wins over `sk-`.
const KNOWN_PREFIXES = ['github_pat_', 'sk_live_', 'sk_test_', 'rk_live_', 'sk-proj-', 'sk-ant-', 'xoxb-', 'xoxp-', 'ghp_', 'AIza', 'AKIA', 'ASIA', 'sk-', 'eyJ', 'SG.'];

// Keeps a recognized key prefix plus 2 chars (otherwise only the first 2 chars), then `…` and the
// last 2, so a secret without a known prefix shows at most 4 of its characters. Strings shorter
// than 12 are hidden entirely.
export function maskSecret(s) {
  const str = String(s);
  if (str.length < 12) return '••••';
  const prefix = KNOWN_PREFIXES.find((p) => str.startsWith(p)) ?? '';
  return `${str.slice(0, prefix.length + 2)}…${str.slice(-2)}`;
}

const globalCopy = (r) => new RegExp(r.source, r.flags.includes('g') ? r.flags : r.flags + 'g');
const JWT = /(?<![A-Za-z0-9_-])eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;

// Masks known secret formats, every JWT, and email addresses.
export function maskText(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const { regex, test } of SECRET_PATTERNS) {
    out = out.replace(globalCopy(regex), (m) => (m.includes('…') || (test && !test(m)) ? m : maskSecret(m)));
  }
  out = out.replace(JWT, (m) => (m.includes('…') ? m : maskSecret(m)));
  return out.replace(EMAIL, (_, first, domain) => `${first}***@${domain}`);
}
