#!/usr/bin/env node
/**
 * `funnel` — the CLI face of prompt-funnel.
 *
 * Subcommands are deliberately few. Anything rich lives behind `review`, because
 * a prompt tool that needs a manual has already lost.
 *
 * @module prompt-funnel/cli
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { compile } from '../compile.js';
import { configPath, loadConfig, resolveApiKey, saveConfig } from '../config.js';
import { gate } from '../gate.js';
import { applyPatches, REFINE_FORMS, parseRefineNote } from '../refine.js';
import { describe as describeSecret } from '../redact.js';
import { renderSpec } from '../render.js';
import { seedsFor, seedDomains, seedCount } from '../seeds.js';
import type { SeedDomain } from '../seeds.js';
import { composeContinuation } from '../session.js';
import { saveSpec, loadSpec, textPath } from '../store.js';
import { TEMPLATES } from '../templates.js';
import { estimateTokens } from '../text.js';
import type { PromptSpec, StyleName } from '../types.js';
import { coerceSpec, validateSpec } from '../validate.js';
import { VERSION } from '../version.js';
import { review } from './review.js';
import { flagOn, flagValue, note, paint, parseArgs } from './shared.js';
import type { Args } from './shared.js';

const HELP = `${paint.bold('funnel')} — 提示词收束：把模糊的请求变成可审计的提示词

${paint.bold('用法')}
  funnel compile "<原始请求>"        收束并输出提示词（管道友好，诊断走 stderr）
  funnel review  "<原始请求>"        交互式：收束 → 改 → 认可 → 输出
  funnel refine  "<修改意见>"        对上一次的 spec 定点改一处，其余不动
  funnel continue "<追问>"           带上已确认的上一轮，只做这一轮的增量
  funnel templates                   列出可用的意图模板
  funnel ideas   "<想法>"              从手写方向库里挑三条，给卡壳的人用
  funnel gate    "<原始请求>"        只看闸门判定，不生成
  funnel render  <spec.json>         从已有 spec 重新渲染（可换排版）
  funnel config  [show|set k v]      查看/修改配置
  funnel mcp                         启动 MCP server（stdio）
  funnel hook                        Claude Code 钩子入口（读 stdin）

${paint.bold('常用参数')}
  --style bluf|compact|checklist     排版：分节 / 紧凑 / 勾选清单
  --engine auto|rules|api|host       引擎；auto = 有 key 用 API，否则规则
  --force                            闸门放行时也强制收束
  --keep-original auto|on|off        是否把原文附在末尾作为权威引用
  --json                             输出 spec JSON 而不是提示词
  --out <文件>                       同时写入文件（默认写 .funnel/last.md）
  -f, --file <文件>                  从文件读取原始请求

${paint.bold('三个入口，一个内核')}
  · 任何 agent：\`funnel mcp\` 后用 funnel_gate / funnel_analyze / funnel_render
  · 终端：\`funnel review\` 手改到满意再发
  · 脚本：\`echo "..." | funnel compile\` 直接进管道

${paint.bold('环境变量')}
  FUNNEL_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY   API 引擎的 key
  FUNNEL_API_BASE / FUNNEL_MODEL                       OpenAI 兼容端点与模型
  FUNNEL_HOME / FUNNEL_CONFIG                          状态目录与配置文件位置
`;

/** Read the request from words, a file, or stdin. */
function readInput(args: Args): string {
  const file = flagValue(args, 'file') ?? flagValue(args, 'f');
  if (file !== undefined) return readFileSync(resolve(file), 'utf8');
  const words = args.words.filter((word) => word !== '-');
  if (words.length > 0) return words.join(' ');
  if (process.stdin.isTTY !== true) return readFileSync(0, 'utf8');
  return '';
}

/** Emit the final prompt, honoring `--out` and `--json`. */
function emit(text: string, spec: PromptSpec, args: Args): void {
  const out = flagValue(args, 'out');
  if (flagOn(args, 'json')) {
    const payload = `${JSON.stringify(spec, null, 2)}\n`;
    if (out !== undefined) writeFileSync(resolve(out), payload, 'utf8');
    process.stdout.write(payload);
    return;
  }
  if (out !== undefined) {
    writeFileSync(resolve(out), text, 'utf8');
    note(paint.dim(`已写入 ${resolve(out)}`));
    return;
  }
  process.stdout.write(text);
}

/** Report what this turn costs, in absolute tokens. */
function reportCost(beforeText: string, afterText: string, passedThrough = false): void {
  const before = estimateTokens(beforeText);
  const after = estimateTokens(afterText);
  const growth = after - before;
  // A ratio on a ten-token input says nothing; the absolute overhead is the cost.
  const ratio = before >= 40 ? `, ${(growth / before).toFixed(1)}×` : '';
  note(paint.dim(`tokens ${before} → ${after}${passedThrough ? '' : `  (+${growth}${ratio})`}`));
}

async function commandCompile(args: Args): Promise<number> {
  const raw = readInput(args);
  if (raw.trim().length === 0) {
    note(paint.red('没有输入。用法：funnel compile "你的请求"'));
    return 2;
  }
  const style = flagValue(args, 'style') as StyleName | undefined;
  const engine = flagValue(args, 'engine') as 'auto' | 'rules' | 'api' | 'host' | undefined;
  const keepOriginal = flagValue(args, 'keep-original') as 'auto' | 'on' | 'off' | undefined;
  const template = flagValue(args, 'template');

  const redact = flagOn(args, 'redact') ? 'on' : flagOn(args, 'no-redact') ? 'off' : 'warn';
  const result = await compile(raw, {
    force: flagOn(args, 'force'),
    redact,
    ...(style !== undefined ? { style } : {}),
    ...(engine !== undefined ? { engine } : {}),
    ...(keepOriginal !== undefined ? { keepOriginal } : {}),
    ...(template !== undefined ? { template } : {}),
  });

  const budgetFlag = flagValue(args, 'budget');
  const budget = budgetFlag === undefined ? undefined : Number(budgetFlag);
  let output = result;

  if (budget !== undefined && Number.isFinite(budget) && estimateTokens(result.rendered.text) > budget) {
    const lean = await compile(raw, {
      force: true,
      engine: engine ?? 'rules',
      style: 'compact',
      keepOriginal: 'off',
      ...(template !== undefined ? { template } : {}),
    });
    if (estimateTokens(lean.rendered.text) < estimateTokens(result.rendered.text)) {
      output = lean;
      note(paint.dim(`超出 ${budget} tokens 预算，已降级为 compact 且不附原文`));
    }
    if (estimateTokens(output.rendered.text) > budget) {
      note(paint.yellow(`压缩后仍超出预算（${estimateTokens(output.rendered.text)} > ${budget}）；长请求的收益本来就小，可以直接发原文`));
    }
  }

  if (output.redactions.length > 0) {
    note(paint.yellow(`⚠ 这段输入里有 ${output.redactions.length} 处敏感信息：`));
    const seen = new Set();
    for (const finding of output.redactions) {
      if (seen.has(finding.kind)) continue;
      seen.add(finding.kind);
      note(paint.yellow(`   · ${describeSecret(finding.kind)}（${finding.text.length} 字符）`));
    }
    note(paint.dim('   --redact 会在收束前打码；不打码则会原样送出'));
  }

  if (output.passedThrough) note(paint.green('✓ 闸门放行：已足够清晰，未改写'));
  for (const entry of output.notes) note(paint.dim(`· ${entry}`));
  const problems = output.rendered.fidelity.issues.filter((issue) => issue.severity === 'error');
  for (const issue of problems) note(paint.red(`! ${issue.detail}`));

  reportCost(raw, output.rendered.text, output.passedThrough);

  emit(output.rendered.text, output.spec, args);
  if (!flagOn(args, 'json') && flagValue(args, 'out') === undefined) {
    saveSpec(output.spec, output.rendered.text);
    note(paint.dim(`已保存 spec：.funnel/last.json · 提示词：.funnel/last.md`));
  }
  return problems.length > 0 ? 1 : 0;
}

function commandGate(args: Args): number {
  const raw = readInput(args);
  if (raw.trim().length === 0) {
    note(paint.red('没有输入'));
    return 2;
  }
  const result = gate(raw);
  if (flagOn(args, 'json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  const verdict = result.decision === 'pass' ? paint.green('pass') : paint.yellow('compile');
  process.stdout.write(`${verdict}  score=${result.score}  intent=${result.signals.intent}\n`);
  for (const [axis, value] of Object.entries(result.axes)) {
    process.stdout.write(`  ${axis.padEnd(12)} ${value.toFixed(2)}\n`);
  }
  for (const reason of result.reasons) process.stdout.write(`  · ${reason}\n`);
  return 0;
}

async function commandReview(args: Args): Promise<number> {
  const raw = readInput(args);
  if (raw.trim().length === 0) {
    note(paint.red('没有输入。用法：funnel review "你的请求"'));
    return 2;
  }
  const style = flagValue(args, 'style') as StyleName | undefined;
  const engine = flagValue(args, 'engine') as 'auto' | 'rules' | 'api' | 'host' | undefined;
  const outcome = await review(raw, {
    ...(style !== undefined ? { style } : {}),
    ...(engine !== undefined ? { engine } : {}),
    force: flagOn(args, 'force'),
  });
  if (!outcome.accepted) {
    note(paint.dim('已退出，未采用'));
    return 130;
  }
  saveSpec(outcome.spec, outcome.text);
  note(paint.dim(`已保存：${textPath()}`));
  emit(outcome.text, outcome.spec, args);
  return 0;
}

function commandRender(args: Args): number {
  const file = args.words[0];
  let spec: PromptSpec | undefined;
  if (file !== undefined) {
    const parsed: unknown = JSON.parse(readFileSync(resolve(file), 'utf8'));
    // The file is its own base. Borrowing `.funnel/last.json` here would attach
    // an unrelated request's source text and silently validate against it.
    spec = coerceSpec(parsed, parsed as PromptSpec);
  } else {
    spec = loadSpec();
  }
  if (spec === undefined) {
    note(paint.red('找不到 spec。先运行 funnel compile，或传入 spec.json 路径'));
    return 2;
  }
  if (spec.meta === undefined || typeof spec.meta.source !== 'string') {
    note(paint.red('spec 缺少 meta.source，无法与原文比对做保真校验。'));
    note(paint.dim('先运行一次 funnel compile（它会写入 .funnel/last.json），或在 spec 里补上 meta.source。'));
    return 2;
  }
  const issues = validateSpec(spec);
  for (const issue of issues) {
    note(issue.severity === 'error' ? paint.red(`! ${issue.detail}`) : paint.yellow(`· ${issue.detail}`));
  }
  const style = flagValue(args, 'style') as StyleName | undefined;
  const keepOriginal = flagValue(args, 'keep-original') as 'auto' | 'on' | 'off' | undefined;
  const rendered = renderSpec(spec, {
    ...(style !== undefined ? { style } : {}),
    ...(keepOriginal !== undefined ? { keepOriginal } : {}),
  });
  emit(rendered.text, spec, args);
  return rendered.fidelity.ok ? 0 : 1;
}

function commandConfig(args: Args): number {
  const action = args.words[0] ?? 'show';
  if (action === 'show' || action === 'get') {
    const config = loadConfig();
    const key = resolveApiKey(config);
    process.stdout.write(`${JSON.stringify({ ...config, apiKey: key === undefined ? '(未设置)' : '(已设置)' }, null, 2)}\n`);
    note(paint.dim(`配置文件：${configPath()}`));
    return 0;
  }
  if (action === 'set') {
    const key = args.words[1];
    const value = args.words[2];
    if (key === undefined || value === undefined) {
      note(paint.red('用法：funnel config set <key> <value>'));
      return 2;
    }
    const patch: Record<string, unknown> = {};
    if (key.startsWith('api.')) {
      patch['api'] = { [key.slice(4)]: value };
    } else if (key === 'api.timeoutMs') {
      patch['api'] = { timeoutMs: Number(value) };
    } else {
      patch[key] = value;
    }
    const next = saveConfig(patch);
    process.stdout.write(`${JSON.stringify(next, null, 2)}\n`);
    return 0;
  }
  note(paint.red(`未知的 config 子命令：${action}`));
  return 2;
}

function commandRefine(args: Args): number {
  const refinement = args.words.join(' ').trim();
  if (refinement.length === 0) {
    note(paint.red('用法：funnel refine "<修改意见>"，例如 funnel refine "第 2 点改成先做爬虫"'));
    for (const form of REFINE_FORMS) note(paint.dim(`  · ${form}`));
    return 2;
  }

  const specFile = flagValue(args, 'spec');
  let spec: PromptSpec | undefined;
  if (specFile !== undefined) {
    try {
      spec = JSON.parse(readFileSync(resolve(specFile), 'utf8')) as PromptSpec;
    } catch (error) {
      note(paint.red(`读不了 spec：${error instanceof Error ? error.message : String(error)}`));
      return 2;
    }
  } else {
    spec = loadSpec();
  }
  if (spec === undefined) {
    note(paint.red('没有可修改的 spec。先跑一次 funnel compile。'));
    return 2;
  }
  if (spec.meta === undefined || typeof spec.meta.source !== 'string') {
    note(paint.red('spec 缺少 meta.source，无法做保真校验。'));
    return 2;
  }

  const patches = parseRefineNote(refinement);
  if (patches.length === 0) {
    note(paint.yellow('没看懂这条意见。支持的形式：'));
    for (const form of REFINE_FORMS) note(paint.dim(`  · ${form}`));
    return 2;
  }

  if (flagOn(args, 'dry')) {
    note(paint.bold('将要应用的改动：'));
    for (const patch of patches) {
      note(paint.dim(`  · ${patch.section}/${patch.op}${patch.index === undefined ? '' : ` #${patch.index + 1}`}${patch.text === undefined ? '' : ` → ${patch.text}`}`));
    }
    return 0;
  }

  const { spec: next, applied } = applyPatches(spec, patches);
  const style = flagValue(args, 'style') as StyleName | undefined;
  const keepOriginal = flagValue(args, 'keep-original') as 'auto' | 'on' | 'off' | undefined;
  const rendered = renderSpec(next, {
    ...(style !== undefined ? { style } : {}),
    ...(keepOriginal !== undefined ? { keepOriginal } : {}),
  });

  for (const entry of applied) note(paint.dim(`· ${entry}`));
  const problems = rendered.fidelity.issues.filter((issue) => issue.severity === 'error');
  for (const issue of problems) note(paint.red(`! ${issue.detail}`));

  saveSpec(next, rendered.text);
  emit(rendered.text, next, args);
  return problems.length > 0 ? 1 : 0;
}

function commandTemplates(): number {
  const entries = Object.values(TEMPLATES);
  const width = Math.max(...entries.map((entry) => entry.id.length));
  for (const entry of entries) {
    process.stdout.write(`${entry.id.padEnd(width)}  ${entry.label}\n`);
    process.stdout.write(`${' '.repeat(width + 2)}${entry.description}\n`);
  }
  return 0;
}

function commandContinue(args: Args): number {
  const followUp = args.words.join(' ').trim();
  if (followUp.length === 0) {
    note(paint.red('用法：funnel continue "<这一轮要改/要加的东西>"'));
    return 2;
  }

  const previous = loadSpec();
  const carry = flagValue(args, 'carry') as 'full' | 'minimal' | 'off' | undefined;
  const { spec, notes } = composeContinuation(previous, followUp, {
    ...(carry !== undefined ? { carry } : {}),
  });

  const style = flagValue(args, 'style') as StyleName | undefined;
  const keepOriginal = flagValue(args, 'keep-original') as 'auto' | 'on' | 'off' | undefined;
  const rendered = renderSpec(spec, {
    ...(style !== undefined ? { style } : {}),
    ...(keepOriginal !== undefined ? { keepOriginal } : {}),
  });

  for (const entry of notes) note(paint.dim(`· ${entry}`));
  const problems = rendered.fidelity.issues.filter((issue) => issue.severity === 'error');
  for (const issue of problems) note(paint.red(`! ${issue.detail}`));
  reportCost(followUp, rendered.text);

  saveSpec(spec, rendered.text);
  emit(rendered.text, spec, args);
  return problems.length > 0 ? 1 : 0;
}

function commandIdeas(args: Args): number {
  const raw = readInput(args).trim();
  if (raw.length === 0) {
    note(paint.red('用法：funnel ideas "<你的想法>"'));
    return 2;
  }

  const domainFlag = flagValue(args, 'domain') as SeedDomain | undefined;
  const limitFlag = flagValue(args, 'limit');
  const limit = limitFlag === undefined ? 3 : Math.max(1, Math.min(3, Number(limitFlag)));
  const seeds = seedsFor(raw, {
    limit,
    ...(domainFlag !== undefined ? { domain: domainFlag } : {}),
  });

  if (flagOn(args, 'json')) {
    process.stdout.write(`${JSON.stringify(seeds, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(
    `手写方向库（共 ${seedCount()} 条，领域：${seedDomains().join(' / ')}）——不是 AI 生成的，选中才会进提示词\n`,
  );
  seeds.forEach((seed, index) => {
    const cost = seed.cost === 'low' ? '低' : seed.cost === 'medium' ? '中' : '高';
    process.stdout.write(`\n${index + 1}. ${seed.title}    ${paint.dim(`成本：${cost} · ${seed.id}`)}\n`);
    process.stdout.write(`   ${seed.why}\n`);
  });
  process.stdout.write('\n');
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (flagOn(args, 'version') || args.command === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (flagOn(args, 'help') || args.command === 'help' || argv.length === 0) {
    process.stdout.write(HELP);
    return 0;
  }

  switch (args.command) {
    case 'compile':
      return await commandCompile(args);
    case 'gate':
      return commandGate(args);
    case 'review':
      return await commandReview(args);
    case 'refine':
      return commandRefine(args);
    case 'continue':
      return commandContinue(args);
    case 'templates':
      return commandTemplates();
    case 'ideas':
      return commandIdeas(args);
    case 'render':
      return commandRender(args);
    case 'config':
      return commandConfig(args);
    case 'mcp': {
      const { serve } = await import('../mcp/server.js');
      await serve();
      return 0;
    }
    case 'hook': {
      const { runHookMain } = await import('../hook-run.js');
      await runHookMain(args.words);
      return 0;
    }
    default:
      note(paint.red(`未知命令：${args.command}`));
      process.stdout.write(HELP);
      return 2;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    note(paint.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });


