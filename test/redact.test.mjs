import { test } from 'node:test';
import assert from 'node:assert/strict';

import { redactAll, redactOne, scanSecrets } from '../dist/redact.js';

const kinds = (text) => scanSecrets(text).map((finding) => finding.kind);

test('provider API keys are found', () => {
  assert.deepEqual(kinds('key: sk-abcdefghijklmnopqrstuvwxyz012345'), ['api-key']);
  assert.deepEqual(kinds('export GITHUB=ghp_abcdefghijklmnopqrstuvwxyz01'), ['api-key']);
  assert.deepEqual(kinds('aws AKIAIOSFODNN7EXAMPLE here'), ['api-key']);
});

test('a JWT is found and masked as a token', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  assert.deepEqual(kinds(`Authorization: ${jwt}`), ['token']);
});

test('a private key block is caught whole', () => {
  const block = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----';
  const findings = scanSecrets(`here it is:\n${block}\nthanks`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'private-key');
  assert.equal(findings[0].text, block);
});

test('password assignments keep the key and mask the value', () => {
  const text = 'db password: hunter2isbad';
  const out = redactAll(text);
  assert.match(out, /password: \[REDACTED:password\]/);
  assert.doesNotMatch(out, /hunter2isbad/);
});

test('credentials in a URL are masked but the host survives', () => {
  const out = redactAll('postgres://admin:s3cret@db.internal:5432/app');
  assert.ok(!out.includes('s3cret'));
  assert.ok(out.includes('db.internal'));
});

test('personal data is flagged as medium', () => {
  const findings = scanSecrets('联系 zhang.san@example.com 或 13812345678');
  assert.deepEqual(findings.map((f) => f.kind).sort(), ['email', 'phone']);
  assert.ok(findings.every((f) => f.severity === 'medium'));
});

test('a local path with a username is flagged', () => {
  assert.deepEqual(kinds('报错在 C:\\Users\\lenovo\\app\\index.ts'), ['path']);
  assert.deepEqual(kinds('报错在 /home/lenovo/app/index.ts'), ['path']);
});

test('redaction is deterministic and reversible in position', () => {
  const text = 'a sk-abcdefghijklmnopqrstuvwxyz012345 b';
  assert.equal(redactOne(text, 0), 'a [REDACTED:api-key] b');
});

test('ordinary numbers and dates are not flagged', () => {
  for (const benign of [
    '端口 8080，版本 1.2.3',
    '2026-11-01 上线',
    'commit a1b2c3d4e5f6',
    '用户 12345 条记录',
    '耗时 138 ms，重试 3 次',
    '订单号 20261101001',
  ]) {
    assert.deepEqual(kinds(benign), [], `false positive on: ${benign}`);
  }
});

test('a public IP is not flagged, an internal one is', () => {
  assert.deepEqual(kinds('访问 8.8.8.8'), []);
  assert.deepEqual(kinds('访问 192.168.1.10'), ['ip']);
  assert.deepEqual(kinds('访问 10.0.0.5'), ['ip']);
});

test('overlapping rules report one finding, not three', () => {
  const text = 'token=sk-abcdefghijklmnopqrstuvwxyz012345';
  const findings = scanSecrets(text);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'api-key');
});

test('multiple findings are redacted in one pass without corrupting the text', () => {
  const text = '邮箱 a@b.com，密钥 sk-abcdefghijklmnopqrstuvwxyz012345，结束';
  const out = redactAll(text);
  assert.equal(out, '邮箱 [REDACTED:email]，密钥 [REDACTED:api-key]，结束');
});
