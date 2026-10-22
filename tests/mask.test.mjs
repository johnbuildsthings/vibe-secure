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

test('maskSecret prefix is floor(len/3) for mid-length strings', () => {
  assert.equal(maskSecret('abcdefghijkl'), 'abcd…kl');
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
