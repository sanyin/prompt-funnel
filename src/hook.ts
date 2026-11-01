/**
 * Claude Code `UserPromptSubmit` hook.
 *
 * This is the one host that exposes a documented "before the prompt is sent"
 * point, so it is the only place the original idea — gate the request, show the
 * user what changed, then send — can be built without waiting on a host SDK.
 *
 * Design rules that matter more than the code:
 *  - **Never break the session.** Any internal error exits 0 with no output, so
 *    a broken hook degrades to "no hook" instead of blocking every prompt.
 *  - **Silent by default.** A clear prompt produces no output and no context
 *    bloat; only ambiguous ones contribute anything.
 *  - **Advisory by default.** Injecting structure is usually welcome; refusing
 *    to send the user's own message is not. Blocking is opt-in.
 *
 * @module prompt-funnel/hook
 */

import { analyzeWithRules } from './analyze.js';
import { describe as describeSecret, scanSecrets } from './redact.js';
import { gate } from './gate.js';
import { renderSpec } from './render.js';

/** Payload Claude Code writes to the hook's stdin. */
export interface HookPayload {
  prompt?: unknown;
  hook_event_name?: unknown;
  [key: string]: unknown;
}

/** `advisory` adds context, `block` refuses the prompt, `off` does nothing. */
export type HookMode = 'advisory' | 'block' | 'off';

/** What the hook should write and with which exit code. */
export interface HookOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** For tests and logs: why the hook stayed silent. */
  reason: 'off' | 'empty' | 'clear' | 'injected' | 'blocked' | 'too-long' | 'error';
}

/** Longest compiled prompt the hook will inject, in characters. */
const MAX_INJECT = 4000;

function silent(reason: HookOutcome['reason']): HookOutcome {
  return { exitCode: 0, stdout: '', stderr: '', reason };
}

function readPrompt(payload: HookPayload): string {
  const value = payload.prompt;
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Decide whether to touch this prompt, and how.
 *
 * Pure and synchronous: it can be unit-tested without a Claude Code install.
 */
export function runHook(payload: HookPayload, options: { mode?: HookMode; force?: boolean } = {}): HookOutcome {
  const mode = options.mode ?? (process.env['FUNNEL_HOOK_MODE'] as HookMode | undefined) ?? 'advisory';
  if (mode === 'off') return silent('off');

  const prompt = readPrompt(payload);
  if (prompt.length === 0) return silent('empty');

  const verdict = gate(prompt);
  if (verdict.decision === 'pass' && options.force !== true) return silent('clear');

  // The hook cannot stop the send, but it can say what is about to leave.
  const findings = scanSecrets(prompt);
  const warning =
    findings.length === 0
      ? ''
      : `⚠ 这段输入里有 ${findings.length} 处敏感信息（${[...new Set(findings.map((f) => describeSecret(f.kind)))].join('、')}），会随原文一起发送。\n\n`;

  const spec = analyzeWithRules(prompt, verdict);
  const rendered = renderSpec(spec, { keepOriginal: 'off' });
  const text = rendered.text.trimEnd();

  if (text.length > MAX_INJECT) return silent('too-long');

  if (mode === 'block') {
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        decision: 'block',
        reason: `提示词收束：这条请求缺少可核对的要素。建议先改成下面这样再发：\n\n${text}`,
      }),
      stderr: '',
      reason: 'blocked',
    };
  }

  return {
    exitCode: 0,
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `${warning}【prompt-funnel 已把这条请求收束成以下结构；缺失信息按"假定"处理，若不符请纠正】\n\n${text}`,
      },
    }),
    stderr: '',
    reason: 'injected',
  };
}

/** Shield the session: any failure is a silent no-op. */
export function safeRunHook(payload: HookPayload, options: { mode?: HookMode; force?: boolean } = {}): HookOutcome {
  try {
    return runHook(payload, options);
  } catch {
    return silent('error');
  }
}
