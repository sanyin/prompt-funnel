import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compact, describeCompaction } from '../tools/compact/compact.mjs';

const transcript = [
  '我们这次要重写上传服务。',
  '并发上限设为 8，超了要排队。',
  '试过用 Redis 做队列，但是公司没有 Redis，放弃了。',
  '第一版实现跑通了，但内存涨得厉害。',
  '决定改用本地队列，文件落在 /var/spool/upload 下。',
  '压力测试脚本在 scripts/load.js，跑一次要 40 秒。',
  '现在的问题是恢复速度慢，重启要 3 分钟。',
  '下一步：把恢复改成惰性的。',
].join('\n\n');

test('compaction drops prose and keeps every literal', () => {
  const { text, report } = compact(transcript, { budget: 60 });
  assert.ok(report.after.tokens < report.before.tokens, 'nothing was saved');
  for (const literal of ['8', '/var/spool/upload', 'scripts/load.js', '40', '3']) {
    assert.ok(text.includes(literal), `lost ${literal}`);
  }
  assert.equal(report.ok, true);
  assert.deepEqual(report.missing, []);
});

test('a unit carrying an executable literal is never a drop candidate', () => {
  const { report, text } = compact(transcript, { budget: 1 });
  const reasons = report.keptFor.map((unit) => unit.why);
  assert.ok(reasons.includes('有必须原样保留的字面量'));
  // A path or identifier must survive even at the smallest budget.
  assert.match(text, /scripts\/load\.js|\/var\/spool\/upload/);
});

test('narrative numbers may be dropped, and the report says so', () => {
  const source = ['第一天并发是 50。', '第二天涨到 800。', '最后决定用本地队列。'].join('\n\n');
  const { report } = compact(source, { budget: 5 });
  assert.equal(report.ok, true);
  assert.ok(report.numbers.missing.length >= 1, 'expected some narrative number to go');
  assert.ok(report.numbers.total >= 2);
});

test('decisions survive even when they have no literal', () => {
  const source = ['先聊聊背景。', '总之这里有很多无关的话要说。', '决定改用本地队列。', '最后一步。'].join('\n\n');
  const { text } = compact(source, { budget: 1 });
  assert.match(text, /决定改用本地队列/);
});

test('the tail is always kept', () => {
  const source = Array.from({ length: 8 }, (_, index) => `第 ${index} 段普通描述。`).join('\n\n');
  const { text } = compact(source, { budget: 1, tail: 2 });
  assert.match(text, /第 6 段/);
  assert.match(text, /第 7 段/);
});

test('nothing to drop returns the source unchanged', () => {
  const source = '只有一句话，里面有 42 这个数字。';
  const { text, report } = compact(source, { budget: 999 });
  assert.equal(text, source);
  assert.equal(report.dropped, 0);
  assert.equal(report.ok, true);
});

test('the report is readable by a human', () => {
  const { report } = compact(transcript, { budget: 60 });
  const summary = describeCompaction(report);
  assert.match(summary, /tokens/);
  assert.match(summary, /✓|✗/u);
});
