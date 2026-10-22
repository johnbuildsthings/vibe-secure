import { SECRET_PATTERNS } from './validate-findings.mjs';

// Keeps the first min(10, floor(len/3)) chars and the last 2. Short strings are hidden entirely.
export function maskSecret(s) {
  const str = String(s);
  if (str.length < 12) return '••••';
  const keep = Math.min(10, Math.floor(str.length / 3));
  return `${str.slice(0, keep)}…${str.slice(-2)}`;
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
