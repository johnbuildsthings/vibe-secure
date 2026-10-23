import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskSecret, maskText } from '../scripts/mask.mjs';

test('maskSecret keeps a prefix and the last 2 chars', () => {
  assert.equal(maskSecret('sk_live_4f' + 'X'.repeat(40) + 'a9'), 'sk_live_4f…a9');
});

test('maskSecret hides short strings entirely', () => {
  assert.equal(maskSecret('short'), '••••');
  assert.equal(maskSecret('elevenchars'), '••••');
});

test('maskSecret without a recognized prefix shows only 2 + 2 chars (R21)', () => {
  assert.equal(maskSecret('abcdefghijkl'), 'ab…kl');
  assert.equal(maskSecret('super-secret-session-value-1234'), 'su…34');
  assert.equal(maskSecret('postgres://app:hunter2hunter2@db.example.com:5432/app'), 'po…pp');
});

test('maskSecret keeps a recognized prefix plus 2 chars (R21)', () => {
  const body = 'Q'.repeat(30) + 'z9';
  const cases = {
    sk_live_: 'sk_live_QQ…z9', sk_test_: 'sk_test_QQ…z9', rk_live_: 'rk_live_QQ…z9',
    'sk-proj-': 'sk-proj-QQ…z9', 'sk-ant-': 'sk-ant-QQ…z9', 'sk-': 'sk-QQ…z9',
    AIza: 'AIzaQQ…z9', AKIA: 'AKIAQQ…z9', ASIA: 'ASIAQQ…z9', eyJ: 'eyJQQ…z9',
    ghp_: 'ghp_QQ…z9', github_pat_: 'github_pat_QQ…z9', 'xoxb-': 'xoxb-QQ…z9',
    'xoxp-': 'xoxp-QQ…z9', 'SG.': 'SG.QQ…z9',
  };
  for (const [prefix, want] of Object.entries(cases)) assert.equal(maskSecret(prefix + body), want, prefix);
});

test('maskText masks emails and Stripe keys', () => {
  const key = 'sk_live_4f' + 'X'.repeat(40) + 'a9';
  const out = maskText(`mail alice@example.com key ${key} end`);
  assert.ok(!out.includes('alice@example.com'));
  assert.ok(!out.includes(key));
  assert.ok(out.includes('a***@example.com'));
  assert.ok(out.includes('sk_live_4f…a9'));
});

test('maskText masks any JWT', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.abcdefghijklmnop';
  const out = maskText(`token=${jwt}`);
  assert.ok(!out.includes(jwt));
  assert.ok(out.includes('…'));
});

test('maskText leaves plain text alone and is idempotent', () => {
  assert.equal(maskText('nothing secret here'), 'nothing secret here');
  const once = maskText('a@b.com sk_live_' + 'Z'.repeat(30));
  assert.equal(maskText(once), once);
});
