#!/usr/bin/env node
/**
 * Live A/B harness: does the compiled prompt actually produce a better answer?
 *
 * This is the question the offline evals deliberately do not answer, because it
 * costs money and needs judgement. What this script does:
 *
 *   1. For every case, sends two arms to the same model — the user's raw request,
 *      and the compiled prompt — N times each, at a fixed temperature.
 *   2. Scores the *objective* part automatically: did the answer contain the
 *      literals the request was about, how long was it, how long did it take.
 *   3. Writes a blind rating sheet for the part only a human can judge.
 *
 * It does not pretend to grade quality by itself. An LLM judge here would score
 * structure instead of results, and would flip on re-runs.
 *
 * Usage:
 *   FUNNEL_API_KEY=sk-... node evals/live.mjs --model deepseek-chat --samples 2
 *   node evals/live.mjs --dry          # print the plan, call nothing
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const dry = argv.includes('--dry');
const model = flag('model', process.env['FUNNEL_MODEL'] ?? 'deepseek-chat');
const base = (flag('base', process.env['FUNNEL_API_BASE'] ?? 'https://api.deepseek.com/v1')).replace(/\/+$/u, '');
const samples = Number(flag('samples', '2'));
const onlyCase = flag('case', undefined);
const key = process.env['FUNNEL_API_KEY'] ?? process.env['OPENAI_API_KEY'] ?? process.env['DEEPSEEK_API_KEY'];

const dataset = JSON.parse(
  (await import('node:fs')).readFileSync(join(here, 'dataset.json'), 'utf8'),
);

const cases = dataset.cases.filter(
  (entry) => (onlyCase === undefined || entry.id === onlyCase) && entry.expect?.decision === 'compile',
);

if (!dry && key === undefined) {
  console.error('缺少 API key：设置 FUNNEL_API_KEY（或 OPENAI_API_KEY / DEEPSEEK_API_KEY），或加 --dry 只看计划。');
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
const outDir = join(here, 'live', `${model}-${stamp}`);

console.log(`model   ${model}`);
console.log(`base    ${base}`);
console.log(`cases   ${cases.length} × 2 arms × ${samples} samples = ${cases.length * 2 * samples} calls`);
console.log(`out     ${outDir}`);

if (dry) {
  for (const entry of cases) console.log(`  · ${entry.id}  «${entry.raw.slice(0, 40)}…»`);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });

async function ask(prompt) {
  const started = Date.now();
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const elapsed = Date.now() - started;
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const payload = await response.json();
  const text = payload.choices?.[0]?.message?.content ?? '';
  return { text, elapsed, usage: payload.usage ?? {} };
}

/** Objective checks only: literals from the request must show up in the answer. */
function objectiveScore(caseEntry, answerText) {
  const literals = (caseEntry.expect.must_keep ?? []).filter((value) => /[\u4e00-\u9fff]/u.test(value) || value.length > 3);
  const hit = literals.filter((value) => answerText.includes(value));
  return {
    literals: literals.length,
    hit: hit.length,
    missing: literals.filter((value) => !hit.includes(value)),
    chars: answerText.length,
  };
}

const rows = [];
for (const caseEntry of cases) {
  const compiled = await compile(caseEntry.raw, {});
  const arms = {
    raw: caseEntry.raw,
    compiled: compiled.rendered.text.trimEnd(),
  };

  for (const [arm, prompt] of Object.entries(arms)) {
    for (let n = 1; n <= samples; n += 1) {
      const { text, elapsed, usage } = await ask(prompt);
      const score = objectiveScore(caseEntry, text);
      writeFileSync(join(outDir, `${caseEntry.id}.${arm}.${n}.md`), `${text}\n`, 'utf8');
      rows.push({
        case: caseEntry.id,
        arm,
        n,
        elapsed,
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        ...score,
      });
      process.stdout.write(`  ${caseEntry.id} ${arm} #${n}  ${elapsed}ms  ${score.hit}/${score.literals} literals  ${score.chars} chars\n`);
    }
  }
}

const group = (arm) => rows.filter((row) => row.arm === arm);
const mean = (values) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);
const rate = (arm) => {
  const entries = group(arm);
  const hit = entries.reduce((sum, row) => sum + row.hit, 0);
  const total = entries.reduce((sum, row) => sum + row.literals, 0);
  return total === 0 ? 0 : hit / total;
};

const summary = [
  `# Live A/B · ${model}`,
  '',
  `- 时间：${new Date().toISOString()}`,
  `- 调用：${rows.length} 次（${cases.length} 用例 × 2 组 × ${samples} 次采样，temperature 0.7）`,
  '',
  '| 指标 | 原文直发 | 收束后 |',
  '| --- | --- | --- |',
  `| 关键内容命中率 | ${(rate('raw') * 100).toFixed(0)}% | ${(rate('compiled') * 100).toFixed(0)}% |`,
  `| 平均响应长度（字符） | ${mean(group('raw').map((r) => r.chars)).toFixed(0)} | ${mean(group('compiled').map((r) => r.chars)).toFixed(0)} |`,
  `| 平均延迟（ms） | ${mean(group('raw').map((r) => r.elapsed)).toFixed(0)} | ${mean(group('compiled').map((r) => r.elapsed)).toFixed(0)} |`,
  `| 输入 tokens | ${mean(group('raw').map((r) => r.promptTokens)).toFixed(0)} | ${mean(group('compiled').map((r) => r.promptTokens)).toFixed(0)} |`,
  '',
  '> 命中率只说明「回答里有没有出现请求中的关键字面量」，它不衡量质量。',
  '> 质量判断见 rating.csv：盲评四列，样本顺序已打乱。',
  '',
];
writeFileSync(join(outDir, 'summary.md'), summary.join('\n'), 'utf8');

// Blind sheet: A/B order shuffled per case, arm hidden until the last column.
const shuffle = (list) => [...list].sort(() => Math.random() - 0.5);
const lines = ['case,A_text,B_text,A_arm,B_arm,命中意图(1-5),遵守约束(1-5),有无编造(0/1),返工轮次(0/1/2)'];
for (const caseEntry of cases) {
  const raw = rows.find((row) => row.case === caseEntry.id && row.arm === 'raw' && row.n === 1);
  const compiled = rows.find((row) => row.case === caseEntry.id && row.arm === 'compiled' && row.n === 1);
  if (raw === undefined || compiled === undefined) continue;
  const order = shuffle(['raw', 'compiled']);
  const label = (arm) => `${caseEntry.id}.${arm}.1.md`;
  lines.push(
    [
      caseEntry.id,
      label(order[0]),
      label(order[1]),
      order[0],
      order[1],
      '', '', '', '',
    ].join(','),
  );
}
writeFileSync(join(outDir, 'rating.csv'), `${lines.join('\n')}\n`, 'utf8');

console.log(`\n结果目录：${outDir}`);
console.log(`汇总：${join(outDir, 'summary.md')}`);
console.log(`盲评表：${join(outDir, 'rating.csv')}`);
