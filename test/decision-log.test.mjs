import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendEntry,
  briefEntries,
  formatEntry,
  initLog,
  parseEntries,
  readEntries,
  searchEntries,
} from '../tools/decision-log/log.mjs';

const temporaryRoot = () => mkdtempSync(join(tmpdir(), 'pf-log-'));

test('an entry round-trips through the file format', () => {
  const entry = {
    topic: 'Redis 队列',
    date: '2026-11-01',
    tried: '用 Redis 做上传队列',
    result: '跑通了',
    reason: '公司没有 Redis 实例，运维不批',
    retry: '线上有了托管 Redis 之后',
  };
  const parsed = parseEntries(formatEntry(entry));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].topic, 'Redis 队列');
  assert.equal(parsed[0].reason, '公司没有 Redis 实例，运维不批');
  assert.equal(parsed[0].retry, '线上有了托管 Redis 之后');
});

test('the log is created on first write and stays append-only', () => {
  const root = temporaryRoot();
  try {
    assert.deepEqual(readEntries(root), []);
    appendEntry(root, { topic: 'A', date: '2026-11-01', result: '失败' });
    appendEntry(root, { topic: 'B', date: '2026-11-02', result: '成功' });
    const entries = readEntries(root);
    assert.deepEqual(entries.map((entry) => entry.topic), ['A', 'B']);
    assert.match(readFileSync(join(root, '.decisions.md'), 'utf8'), /^# 决策日志/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an empty topic is refused rather than written', () => {
  const root = temporaryRoot();
  try {
    assert.throws(() => appendEntry(root, { topic: '   ' }), /topic/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('search matches every term and ignores the rest', () => {
  const root = temporaryRoot();
  try {
    appendEntry(root, { topic: 'Redis 队列', reason: '公司没有实例', date: '2026-11-01' });
    appendEntry(root, { topic: '本地上传', reason: '内存涨得厉害', date: '2026-11-02' });
    assert.equal(searchEntries(root, 'Redis').length, 1);
    assert.equal(searchEntries(root, 'Redis 队列').length, 1);
    assert.equal(searchEntries(root, '内存').length, 1);
    assert.equal(searchEntries(root, 'Kafka').length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the agent briefing is one line per entry and says when it is empty', () => {
  const root = temporaryRoot();
  try {
    assert.match(briefEntries([]), /没有相关记录/);
    appendEntry(root, { topic: 'Redis', tried: '做队列', result: '失败', reason: '没有实例', date: '2026-11-01' });
    const brief = briefEntries(readEntries(root));
    assert.match(brief, /^- Redis：/m);
    assert.match(brief, /没有实例/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('init is idempotent', () => {
  const root = temporaryRoot();
  try {
    assert.equal(initLog(root).created, true);
    assert.equal(initLog(root).created, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
