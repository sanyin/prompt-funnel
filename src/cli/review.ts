/**
 * The review loop.
 *
 * This is the part the user actually feels. Three rules shaped it:
 *  1. Editing beats chatting — press `e` and you are in your own editor, not in
 *     a negotiation with another model.
 *  2. Nothing is accepted silently — the assumptions and open questions are
 *     printed next to the prompt, so a wrong inference is visible before it ships.
 *  3. The original is always one key away (`d`), because trust comes from being
 *     able to check, not from being told.
 *
 * @module prompt-funnel/cli/review
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import type { PromptSpec, StyleName } from '../types.js';
import { compile } from '../compile.js';
import { diffLines, formatDiff } from '../diff.js';
import { checkFidelity } from '../validate.js';
import { note, paint } from './shared.js';

/** Options carried into the loop from the command line. */
export interface ReviewOptions {
  style?: StyleName;
  engine?: 'auto' | 'rules' | 'api' | 'host';
  keepOriginal?: 'auto' | 'on' | 'off';
  force?: boolean;
}

/** Outcome of a review session. */
export interface ReviewOutcome {
  text: string;
  spec: PromptSpec;
  accepted: boolean;
}

const STYLES: StyleName[] = ['bluf', 'compact', 'checklist'];

function nextStyle(current: StyleName): StyleName {
  const index = STYLES.indexOf(current);
  return STYLES[(index + 1) % STYLES.length] as StyleName;
}

/** Map a free-text refinement note to the one thing the rules engine can honor. */
export function styleForNote(noteText: string, current: StyleName): { style: StyleName; explained: string } {
  if (/短|精简|简洁|压缩|short|brief|tight/iu.test(noteText)) {
    return { style: 'compact', explained: '改成紧凑排版（规则引擎不改措辞，只改结构）' };
  }
  if (/勾选|清单|checkbox|checklist/iu.test(noteText)) {
    return { style: 'checklist', explained: '改成勾选清单（适合交给 agent 执行）' };
  }
  if (/详细|完整|分节|结构|detail|structur/iu.test(noteText)) {
    return { style: 'bluf', explained: '改回分节结构（结论—条目—验收）' };
  }
  return { style: current, explained: '规则引擎只调结构，措辞级改写需要接入 API 引擎' };
}

function frame(title: string, body: string): string {
  const line = '─'.repeat(Math.max(12, Math.min(72, title.length + 8)));
  return `${paint.dim(line)}\n${paint.bold(title)}\n${paint.dim(line)}\n${body}`;
}

function gateCard(spec: PromptSpec, notes: string[]): string {
  const { gate } = spec.meta;
  const verdict = gate.decision === 'pass' ? paint.green('放行') : paint.yellow('收束');
  const axes = Object.entries(gate.axes)
    .map(([key, value]) => `${key} ${value.toFixed(2)}`)
    .join(' · ');
  const lines = [
    `判定      ${verdict}    清晰度 ${gate.score.toFixed(2)}`,
    `签名      ${axes}`,
    `意图      ${spec.intent}    引擎 ${spec.meta.engine}`,
  ];
  if (notes.length > 0) lines.push(`说明      ${notes.join('；')}`);
  for (const reason of gate.reasons) lines.push(`理由      ${reason}`);
  return frame('闸门', lines.join('\n'));
}

function fidelityLine(spec: PromptSpec, text: string): string {
  const report = checkFidelity(spec, text);
  const tone = report.ok ? paint.green : paint.red;
  const problems = report.issues.filter((issue) => issue.severity === 'error').length;
  const warnings = report.issues.filter((issue) => issue.severity === 'warn').length;
  const head = `保真      原文保留 ${(report.retention * 100).toFixed(0)}%  ·  未溯源 ${report.unverifiable.length}  ·  错误 ${problems}  ·  提示 ${warnings}`;
  const details = report.issues.map((issue) => `          ${issue.severity === 'error' ? paint.red('!') : paint.yellow('·')} ${issue.detail}`);
  return [tone(head), ...details].join('\n');
}

/**
 * Split an `$EDITOR`-style command into a program and its leading arguments.
 *
 * `EDITOR="code --wait"` and `EDITOR="C:\Program Files\...\editor.exe"` are both
 * common, and `spawnSync` takes them as two different things. Naive whitespace
 * splitting breaks the second, so quotes are honored.
 */
export function splitCommand(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (const char of value) {
    if (quote !== null) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ' ' || char === '\t') {
      if (current.length > 0) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

function launchEditor(editor: string, file: string): boolean {
  const [command, ...leading] = splitCommand(editor);
  if (command === undefined) return false;
  // .cmd/.bat shims (VS Code, Sublime) are not executables; Windows needs a shell.
  const needsShell = process.platform === 'win32' && /\.(?:cmd|bat)$/iu.test(command);
  const result = spawnSync(command, [...leading, file], { stdio: 'inherit', shell: needsShell });
  return result.error === undefined;
}

function openEditor(content: string): string {
  const file = join(tmpdir(), `funnel-review-${Date.now()}.md`);
  writeFileSync(file, content, 'utf8');
  const editor =
    process.env['VISUAL'] ?? process.env['EDITOR'] ?? (process.platform === 'win32' ? 'notepad' : 'vi');
  note(paint.dim(`打开编辑器：${editor}（保存并关闭后继续）`));

  let opened = launchEditor(editor, file);
  if (!opened && process.platform === 'win32') {
    note(paint.yellow(`启动 ${editor} 失败，改用记事本`));
    opened = launchEditor('notepad', file);
  }
  if (!opened) {
    note(paint.yellow('没有可用的编辑器；请设置 $EDITOR。本次忽略编辑。'));
    rmSync(file, { force: true });
    return content;
  }

  const edited = readFileSync(file, 'utf8');
  rmSync(file, { force: true });
  return edited;
}

/**
 * Run the interactive loop.
 *
 * @param initial - the user's raw request.
 * @param options - style/engine overrides.
 */
export async function review(initial: string, options: ReviewOptions): Promise<ReviewOutcome> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let style: StyleName = options.style ?? 'bluf';
  let raw = initial;
  let refinement: string | undefined;
  let force = options.force === true;

  const ask = async (question: string): Promise<string> => {
    try {
      return (await rl.question(question)).trim();
    } catch {
      return 'q';
    }
  };

  try {
    for (;;) {
      const result = await compile(raw, {
        style,
        force,
        ...(options.engine !== undefined ? { engine: options.engine } : {}),
        ...(options.keepOriginal !== undefined ? { keepOriginal: options.keepOriginal } : {}),
        ...(refinement !== undefined ? { note: refinement } : {}),
      });

      note(gateCard(result.spec, result.notes));

      if (result.passedThrough) {
        note(frame('原文（闸门判定无需收束）', result.rendered.text.trimEnd()));
        const choice = await ask(
          `${paint.dim('[回车] 直接用原文  ·  [f] 强制收束  ·  [q] 退出')}\n> `,
        );
        if (choice === 'q') return { text: result.rendered.text, spec: result.spec, accepted: false };
        if (choice === 'f') {
          force = true;
          continue;
        }
        return { text: result.rendered.text, spec: result.spec, accepted: true };
      }

      note(frame('收束后', result.rendered.text.trimEnd()));
      note(fidelityLine(result.spec, result.rendered.text));
      if (result.spec.openQuestions.length > 0) {
        note(paint.yellow(`          ${result.spec.openQuestions.length} 个待确认问题已写进提示词；不回答也会按默认假设继续`));
      }

      const choice = await ask(
        `${paint.dim('[回车] 采用并输出  ·  [e] 编辑  ·  [r] 给意见重做  ·  [d] 看差异  ·  [s] 换排版  ·  [q] 退出')}\n> `,
      );

      if (choice === 'q') return { text: result.rendered.text, spec: result.spec, accepted: false };

      if (choice === 'd') {
        const diff = diffLines(raw, result.rendered.text);
        note(frame('差异：原文 → 收束', formatDiff(diff)));
        continue;
      }

      if (choice === 's') {
        style = nextStyle(style);
        note(paint.dim(`排版切换为 ${style}`));
        continue;
      }

      if (choice === 'r') {
        const feedback = await ask('一句意见（例：太长了 / 要更严格）：');
        if (feedback.length === 0) continue;
        refinement = feedback;
        style = styleForNote(feedback, style).style;
        note(paint.dim(styleForNote(feedback, style).explained));
        continue;
      }

      if (choice === 'e') {
        const edited = openEditor(result.rendered.text);
        if (edited.trim().length === 0) {
          note(paint.red('编辑后内容为空，已忽略'));
          continue;
        }
        const report = checkFidelity(result.spec, edited);
        if (!report.ok) {
          note(
            paint.yellow(
              `编辑后出现原文没有的字面量：${report.unverifiable.join('、')}（若确为你的修改，忽略即可）`,
            ),
          );
        }
        return { text: edited.endsWith('\n') ? edited : `${edited}\n`, spec: result.spec, accepted: true };
      }

      return { text: result.rendered.text, spec: result.spec, accepted: true };
    }
  } finally {
    rl.close();
  }
}
