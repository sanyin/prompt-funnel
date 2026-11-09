/**
 * A decision log for coding agents.
 *
 * The most expensive thing an agent does is repeat a dead end. It cannot know
 * that Redis was ruled out three sessions ago, so it tries it again, fails the
 * same way, and costs the same tokens.
 *
 * The fix is deliberately unfashionable: a markdown file in the repository,
 * written by a human or an agent, read before starting. No embeddings, no vector
 * store, no daemon — because a decision is small, rare and worth reading in full.
 *
 * @module tools/decision-log
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const FILE_NAME = '.decisions.md';

const HEADER = `# 决策日志

> 每一条都是「试过、放弃、为什么、什么条件下可以重试」。
> 开始一个任务之前先读它——重复撞同一堵墙是最贵的浪费。

`;

/** One entry, as written to the file. */
export function formatEntry(entry) {
  const lines = [`## ${entry.topic}`, `- 日期：${entry.date}`];
  if (entry.tried !== undefined) lines.push(`- 试过：${entry.tried}`);
  if (entry.result !== undefined) lines.push(`- 结果：${entry.result}`);
  if (entry.reason !== undefined) lines.push(`- 原因：${entry.reason}`);
  if (entry.retry !== undefined) lines.push(`- 可以重试的条件：${entry.retry}`);
  return `${lines.join('\n')}\n`;
}

/** Split a log file into entries. Order is preserved (oldest first). */
export function parseEntries(text) {
  const parts = text.split(/^## /mu).slice(1);
  return parts.map((part) => {
    const lines = part.trim().split('\n');
    const topic = (lines.shift() ?? '').trim();
    const fields = {};
    for (const line of lines) {
      const match = /^-\s*([^：:]+)[：:]\s*(.*)$/u.exec(line.trim());
      if (match === null) continue;
      fields[match[1].trim()] = match[2].trim();
    }
    return {
      topic,
      date: fields['日期'] ?? fields['date'] ?? '',
      tried: fields['试过'] ?? fields['tried'],
      result: fields['结果'] ?? fields['result'],
      reason: fields['原因'] ?? fields['reason'],
      retry: fields['可以重试的条件'] ?? fields['retry'],
    };
  });
}

/**
 * Append one entry.
 *
 * @param {string} root - project root; the file lives at its top level.
 * @param {object} entry - `{ topic, tried?, result?, reason?, retry?, date? }`
 */
export function appendEntry(root, entry) {
  if (typeof entry.topic !== 'string' || entry.topic.trim().length === 0) {
    throw new Error('topic 不能为空');
  }
  const path = join(root, FILE_NAME);
  const date = entry.date ?? new Date().toISOString().slice(0, 10);
  const body = formatEntry({ ...entry, topic: entry.topic.trim(), date });

  const existing = existsSync(path) ? readFileSync(path, 'utf8') : HEADER;
  const next = `${existing.trimEnd()}\n\n${body}`;
  writeFileSync(path, next, 'utf8');
  return { path, entry: { ...entry, date } };
}

/** Read every entry, oldest first. */
export function readEntries(root) {
  const path = join(root, FILE_NAME);
  if (!existsSync(path)) return [];
  return parseEntries(readFileSync(path, 'utf8'));
}

/**
 * Find entries relevant to a topic or question.
 *
 * Deliberately simple: every term must appear somewhere in the entry. An agent
 * asking "can I use Redis for the queue" should not get every entry back.
 */
export function searchEntries(root, query) {
  const terms = String(query)
    .toLowerCase()
    .split(/[\s,，。、]+/u)
    .filter((term) => term.length > 0);
  if (terms.length === 0) return readEntries(root);
  return readEntries(root).filter((entry) => {
    const haystack = [entry.topic, entry.tried, entry.result, entry.reason, entry.retry]
      .filter((value) => typeof value === 'string')
      .join(' ')
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** A compact briefing for an agent about to start work. */
export function briefEntries(entries) {
  if (entries.length === 0) return '决策日志里没有相关记录。';
  return entries
    .map((entry) => {
      const bits = [entry.tried === undefined ? undefined : `试过 ${entry.tried}`, entry.result, entry.reason]
        .filter((value) => typeof value === 'string' && value.length > 0)
        .join('；');
      const retry = entry.retry === undefined ? '' : `（可重试条件：${entry.retry}）`;
      return `- ${entry.topic}：${bits}${retry}`;
    })
    .join('\n');
}

/** Ensure the file exists, with its header. */
export function initLog(root) {
  const path = join(root, FILE_NAME);
  if (existsSync(path)) return { path, created: false };
  mkdirSync(root, { recursive: true });
  writeFileSync(path, HEADER, 'utf8');
  return { path, created: true };
}
