#!/usr/bin/env node
/**
 * Offline evaluation harness.
 *
 * What this measures, and what it deliberately does not:
 *
 *   Measured here: gate agreement with hand-labelled expectations, whether the
 *   compile preserved the literals the request depends on, how much it invented
 *   (fidelity), how much wording it kept (retention), and how much longer the
 *   prompt got. All of it is deterministic and runs with no API key.
 *
 *   Not measured here: whether the model's *answer* got better. That needs a
 *   live model and a judge, costs money, and cannot run in CI. The claim this
 *   file supports is narrow and checkable: the compiler is faithful, it asks when
 *   it should, and it stays short. Anything stronger would be marketing.
 *
 * Usage: node evals/run.mjs [--json] [--write-report]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile, estimateTokens, gate } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(readFileSync(join(here, 'dataset.json'), 'utf8'));

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const results = [];

for (const testCase of dataset.cases) {
  const raw = testCase.raw;
  const verdict = gate(raw);
  const force = testCase.expect.force === true || (verdict.decision === 'pass' && testCase.expect.decision === 'compile');
  const compiled = await compile(raw, { force });
  const text = compiled.rendered.text;
  const spec = compiled.spec;

  const failures = [];
  if (verdict.decision !== testCase.expect.decision) {
    failures.push(`gate decided ${verdict.decision}, expected ${testCase.expect.decision}`);
  }
  for (const literal of testCase.expect.must_keep ?? []) {
    if (!text.includes(literal)) failures.push(`lost literal: ${literal}`);
  }
  if (testCase.expect.must_ask === true && compiled.passedThrough !== true && spec.openQuestions.length === 0) {
    failures.push('expected at least one open question');
  }
  const minRequirements = testCase.expect.min_requirements ?? 0;
  if (spec.requirements.length < minRequirements) {
    failures.push(`only ${spec.requirements.length} requirements, expected >= ${minRequirements}`);
  }
  if (typeof testCase.expect.must_not_be_objective === 'string' && spec.objective.text.includes(testCase.expect.must_not_be_objective)) {
    failures.push(`objective contains disallowed text: ${testCase.expect.must_not_be_objective}`);
  }
  if (compiled.rendered.fidelity.issues.some((issue) => issue.severity === 'error')) {
    failures.push('fidelity reported an error');
  }

  results.push({
    id: testCase.id,
    tag: testCase.tag,
    note: testCase.note,
    decision: verdict.decision,
    expected: testCase.expect.decision,
    score: verdict.score,
    passedThrough: compiled.passedThrough,
    requirements: spec.requirements.length,
    questions: spec.openQuestions.length,
    assumptions: spec.assumptions.length,
    retention: compiled.rendered.fidelity.retention,
    invented: compiled.rendered.fidelity.unverifiable.length,
    rawTokens: estimateTokens(raw),
    outTokens: estimateTokens(text),
    failures,
  });
}

const total = results.length;
const passed = results.filter((result) => result.failures.length === 0).length;
const gateAgree = results.filter((result) => result.decision === result.expected).length;
const retentions = results.filter((result) => !result.passedThrough).map((result) => result.retention);
const growth = results
  .filter((result) => !result.passedThrough)
  .map((result) => (result.outTokens - result.rawTokens) / Math.max(1, result.rawTokens));
const invented = results.reduce((sum, result) => sum + result.invented, 0);

const summary = {
  total,
  passed,
  failed: total - passed,
  gateAgreement: Number((gateAgree / total).toFixed(3)),
  passedThrough: results.filter((result) => result.passedThrough).length,
  medianRetention: Number(median(retentions).toFixed(3)),
  medianGrowth: Number(median(growth).toFixed(3)),
  medianRawTokens: Math.round(median(results.map((result) => result.rawTokens))),
  medianOutTokens: Math.round(median(results.filter((result) => !result.passedThrough).map((result) => result.outTokens))),
  inventedLiterals: invented,
  results,
};

const wantsJson = process.argv.includes('--json');
const wantsReport = process.argv.includes('--write-report');

if (wantsJson) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  console.log(`cases            ${total}`);
  console.log(`passing          ${passed}/${total}`);
  console.log(`gate agreement   ${(summary.gateAgreement * 100).toFixed(0)}%`);
  console.log(`passed through   ${summary.passedThrough}`);
  console.log(`median retention ${(summary.medianRetention * 100).toFixed(0)}%`);
  console.log(`tokens           raw ${summary.medianRawTokens} → compiled ${summary.medianOutTokens} (median, ${(summary.medianGrowth * 100).toFixed(0)}% growth)`);
  console.log(`invented tokens  ${summary.inventedLiterals}`);
  const failing = results.filter((result) => result.failures.length > 0);
  if (failing.length > 0) {
    console.log('\nfailures:');
    for (const result of failing) {
      console.log(`  ${result.id}: ${result.failures.join('; ')}`);
    }
  }
}

if (wantsReport) {
  const lines = [];
  lines.push('# 评测报告（自动生成）');
  lines.push('');
  lines.push(`- 用例数：${total}　通过：${passed}　失败：${total - passed}`);
  lines.push(`- 闸门与人工标注一致率：${(summary.gateAgreement * 100).toFixed(0)}%`);
  lines.push(`- 被闸门放行的用例：${summary.passedThrough}`);
  lines.push(`- 中位保真率（原文词保留）：${(summary.medianRetention * 100).toFixed(0)}%`);
  lines.push(
    `- 长度：原文中位 ${summary.medianRawTokens} tokens → 收束后中位 ${summary.medianOutTokens} tokens（${(summary.medianGrowth * 100).toFixed(0)}%）`,
  );
  lines.push(`- 未溯源字面量总数：${summary.inventedLiterals}`);
  lines.push('');
  lines.push('| 用例 | 标签 | 判定 | 期望 | 清晰度 | 要求数 | 问题数 | 保真 | 长度变化 | 结果 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const result of results) {
    const growthPct = `${Math.round(((result.outTokens - result.rawTokens) / Math.max(1, result.rawTokens)) * 100)}%`;
    lines.push(
      `| ${result.id} | ${result.tag} | ${result.decision} | ${result.expected} | ${result.score.toFixed(2)} | ${result.requirements} | ${result.questions} | ${(result.retention * 100).toFixed(0)}% | ${growthPct} | ${result.failures.length === 0 ? '通过' : '失败'} |`,
    );
  }
  lines.push('');
  lines.push('> 本表只衡量「编译是否忠实、该问的是否问了、有没有变长」。');
  lines.push('> 模型最终回答是否更好，需要接上真实模型与评审再测，见 docs/EVAL.md。');
  lines.push('');
  writeFileSync(join(here, 'report.md'), lines.join('\n'), 'utf8');
  console.log(`\nreport written to ${join(here, 'report.md')}`);
}

process.exitCode = summary.failed > 0 ? 1 : 0;
