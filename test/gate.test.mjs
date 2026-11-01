import { test } from 'node:test';
import assert from 'node:assert/strict';

import { gate } from '../dist/index.js';

test('a specific error question passes the gate', () => {
  const result = gate("这段代码为什么报 TypeError: Cannot read properties of undefined？");
  assert.equal(result.decision, 'pass');
  assert.equal(result.signals.intent, 'debug');
  assert.ok(result.score >= 0.62);
});

test('a vague one-liner is compiled', () => {
  const result = gate('帮我优化一下这个东西');
  assert.equal(result.decision, 'compile');
  assert.ok(result.score < 0.62);
  assert.ok(result.axes.deliverable <= 0.3);
});

test('several tasks in one breath are always compiled', () => {
  const result = gate('帮我写一个爬虫，同时加上代理池，另外再做一个可视化面板');
  assert.equal(result.decision, 'compile');
  assert.equal(result.signals.goals, 3);
  assert.match(result.reasons.join('\n'), /3 个并列任务/);
});

test('a conversational follow-up is never rewritten', () => {
  for (const followUp of ['继续', '好的', '再改一下第 2 点', 'ok']) {
    const result = gate(followUp);
    assert.equal(result.decision, 'pass', `expected pass for ${followUp}`);
    assert.match(result.reasons[0], /追问/);
  }
});

test('axes stay inside 0..1 and the weighted score is consistent', () => {
  const text = '把 src/app.ts 里的 fetchAll 改成并发 8，并且不要改导出签名，最终要能通过 pnpm test';
  const result = gate(text);
  for (const value of Object.values(result.axes)) {
    assert.ok(value >= 0 && value <= 1);
  }
  assert.ok(result.score >= 0 && result.score <= 1);
  assert.equal(result.signals.intent, 'execute');
});

test('an empty-ish request is compiled rather than passed', () => {
  const result = gate('搞一下');
  assert.equal(result.decision, 'compile');
});
