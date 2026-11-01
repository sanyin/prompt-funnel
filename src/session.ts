/**
 * Session awareness: carrying an agreed spec into the next turn.
 *
 * A follow-up like "再补个测试" has no standalone meaning. Sending it alone loses
 * everything the previous turns established; re-analysing it alone invents
 * context the user never gave. The honest middle is to send both parts, clearly
 * separated: what is already agreed, and what this turn adds.
 *
 * That is what {@link composeContinuation} produces — no model call, no guessing
 * at what "继续" meant.
 *
 * @module prompt-funnel/session
 */

import { analyzeWithRules } from './analyze.js';
import { gate } from './gate.js';
import type { Item, PromptSpec } from './types.js';

/** Longest carried summary, in characters, before sections get truncated. */
const MAX_CARRIED = 1200;

function bullets(values: Item[], limit: number): string[] {
  return values.slice(0, limit).map((item) => item.text.replace(/\s+/gu, ' ').trim());
}

/** Markdown summary of what the previous turn settled. */
export function summarize(spec: PromptSpec): string {
  // A spec that is itself a continuation must not lose the thread's original
  // objective: its own `objective` is only the most recent increment.
  if (spec.carried !== undefined) {
    const recent = [`最近一轮：${spec.objective.text}`];
    if (spec.requirements.length > 0) {
      recent.push(`本轮要求：${spec.requirements.slice(0, 4).map((item) => item.text).join('；')}`);
    }
    const merged = `${spec.carried.text}\n${recent.join('\n')}`;
    return merged.length > MAX_CARRIED ? `${merged.slice(0, MAX_CARRIED)}…` : merged;
  }

  const lines: string[] = [`目标：${spec.objective.text}`];
  if (spec.requirements.length > 0) {
    lines.push('要求：');
    spec.requirements.slice(0, 8).forEach((requirement, index) => {
      lines.push(`  ${index + 1}. ${requirement.text}`);
    });
  }
  if (spec.constraints.length > 0) lines.push(`约束：${bullets(spec.constraints, 4).join('；')}`);
  if (spec.nonGoals.length > 0) lines.push(`不要做：${bullets(spec.nonGoals, 4).join('；')}`);
  if (spec.deliverable.format !== undefined) lines.push(`交付：${spec.deliverable.format.text}`);
  if (spec.acceptance.length > 0) lines.push(`完成标准：${bullets(spec.acceptance, 3).join('；')}`);

  const text = lines.join('\n');
  return text.length > MAX_CARRIED ? `${text.slice(0, MAX_CARRIED)}…` : text;
}

/** Result of folding a follow-up onto a previous spec. */
export interface Continuation {
  spec: PromptSpec;
  /** Notes for the CLI/agent to show, e.g. that no previous turn existed. */
  notes: string[];
}

/**
 * Build the spec for a follow-up turn.
 *
 * The follow-up is analysed on its own (so its own requirements and constraints
 * still count), then the previous turn is attached as settled context. The
 * combined source text is recorded so fidelity is checked against everything the
 * user has actually said in this thread.
 */
export function composeContinuation(previous: PromptSpec | undefined, followUp: string): Continuation {
  const text = followUp.trim();
  if (text.length === 0) throw new Error('输入为空');

  const current = analyzeWithRules(text, gate(text));
  const notes: string[] = [];

  if (previous === undefined) {
    notes.push('没有上一轮的 spec，按普通请求处理');
    return { spec: current, notes };
  }

  const carried = summarize(previous);
  const spec: PromptSpec = {
    ...current,
    carried: { text: carried, source: 'inferred' },
    meta: {
      ...current.meta,
      source: `${previous.meta.source}\n\n${text}`,
      ...(previous.meta.template !== undefined ? { template: previous.meta.template } : {}),
    },
  };

  // Turn-local questions would be answered by the carried context; keep only the
  // ones the follow-up itself genuinely leaves open.
  notes.push(`已带上上一轮：${previous.objective.text.slice(0, 40)}`);
  return { spec, notes };
}
