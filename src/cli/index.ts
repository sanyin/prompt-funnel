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
import { renderSpec } from '../render.js';
import { saveSpec, loadSpec, textPath } from '../store.js';
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
  funnel gate    "<原始请求>"        只看闸门判定，不生成
  funnel render  <spec.json>         从已有 spec 重新渲染（可换排版）
  funnel config  [show|set k v]      查看/修改配置
  funnel mcp                         启动 MCP server（stdio）

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

async function commandCompile(args: Args): Promise<number> {
  const raw = readInput(args);
  if (raw.trim().length === 0) {
    note(paint.red('没有输入。用法：funnel compile "你的请求"'));
    return 2;
  }
  const style = flagValue(args, 'style') as StyleName | undefined;
  const engine = flagValue(args, 'engine') as 'auto' | 'rules' | 'api' | 'host' | undefined;
  const keepOriginal = flagValue(args, 'keep-original') as 'auto' | 'on' | 'off' | undefined;

  const result = await compile(raw, {
    force: flagOn(args, 'force'),
    ...(style !== undefined ? { style } : {}),
    ...(engine !== undefined ? { engine } : {}),
    ...(keepOriginal !== undefined ? { keepOriginal } : {}),
  });

  if (result.passedThrough) note(paint.green('✓ 闸门放行：已足够清晰，未改写'));
  for (const entry of result.notes) note(paint.dim(`· ${entry}`));
  const problems = result.rendered.fidelity.issues.filter((issue) => issue.severity === 'error');
  for (const issue of problems) note(paint.red(`! ${issue.detail}`));

  emit(result.rendered.text, result.spec, args);
  if (!flagOn(args, 'json') && flagValue(args, 'out') === undefined) {
    saveSpec(result.spec, result.rendered.text);
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
    const base = loadSpec() ?? (parsed as PromptSpec);
    spec = coerceSpec(parsed, base as PromptSpec);
  } else {
    spec = loadSpec();
  }
  if (spec === undefined) {
    note(paint.red('找不到 spec。先运行 funnel compile，或传入 spec.json 路径'));
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
    case 'render':
      return commandRender(args);
    case 'config':
      return commandConfig(args);
    case 'mcp': {
      const { serve } = await import('../mcp/server.js');
      await serve();
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
