/**
 * The gate.
 *
 * A convergence entry point that rewrites everything is a tax. Most requests
 * are already clear, and rewriting them costs latency, tokens, and trust. The
 * gate exists so the expensive path only runs when it can plausibly help.
 *
 * Score six axes, weight them, and return a decision with readable reasons.
 * Thresholds live here rather than in a config file because a tunable gate that
 * nobody tunes is worse than a documented one.
 *
 * @module prompt-funnel/gate
 */

import type { GateAxes, GateResult, IntentClass } from './types.js';
import { estimateTokens, splitSentences } from './text.js';
import {
  ACCEPTANCE_RE,
  ARTIFACT_RE,
  CONSTRAINT_RE,
  CONTEXT_RE,
  NON_GOAL_RE,
  countGoals,
  detectIntent,
  hasAdditiveConnector,
  hasTaskVerb,
  isConversational,
  isQuestion,
} from './signals.js';

/** Weighted clarity below this is worth restructuring. */
export const COMPILE_THRESHOLD = 0.62;

const WEIGHTS: Record<keyof GateAxes, number> = {
  goal: 0.3,
  deliverable: 0.2,
  context: 0.15,
  constraints: 0.15,
  acceptance: 0.15,
  risk: 0.05,
};

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

function goalAxis(text: string, intent: IntentClass): number {
  // Asking a specific question is an explicit goal, even with no imperative verb.
  if (isQuestion(text)) return 0.95;
  if (intent === 'answer') return 0.95;
  if (hasTaskVerb(text)) return 1;
  if (/(?:帮我|请问|看看|搞一下|弄一下|处理一下|看看这个)/iu.test(text)) return 0.6;
  if (estimateTokens(text) < 4) return 0.2;
  return 0.45;
}

function deliverableAxis(text: string, intent: IntentClass): number {
  if (isQuestion(text) || intent === 'answer') return 0.85;
  if (ARTIFACT_RE.test(text)) return 1;
  // Naming the file to change is as concrete as naming the artifact type.
  if (/(?:[\w./-]+\.(?:ts|tsx|js|jsx|mjs|py|go|rs|java|vue|md|json|ya?ml|toml)|\/[\w./-]+)/u.test(text)) {
    return 0.8;
  }
  if (/(?:给我|输出|返回|交付|产出|写出来|列出来)/iu.test(text)) return 0.6;
  if (intent === 'plan') return 0.5;
  return 0.25;
}

function contextAxis(text: string): number {
  const tokens = estimateTokens(text);
  let score = 0;
  if (tokens >= 25) score += 0.4;
  if (tokens >= 60) score += 0.2;
  if (CONTEXT_RE.test(text)) score += 0.3;
  if (/(?:\/[\w.-]+\.\w+|[A-Za-z]:\\|https?:\/\/|`[^`]+`)/u.test(text)) score += 0.2;
  // A pasted error message is high-value context even though it is not a path.
  if (/(?:[A-Z][a-zA-Z]*Error|Error:|TypeError|undefined|null|NaN|Traceback|at .*\(\S+:\d+)/u.test(text)) score += 0.3;
  return clamp(score);
}

function constraintAxis(text: string): number {
  const hits = (text.match(CONSTRAINT_RE) ?? []).length;
  if (hits === 0) return estimateTokens(text) > 30 ? 0.4 : 0.15;
  return clamp(0.6 + hits * 0.15);
}

function acceptanceAxis(text: string): number {
  if (ACCEPTANCE_RE.test(text)) return 1;
  // For a question, "an answer that explains it" is the implicit done-state.
  if (isQuestion(text)) return 0.6;
  if (NON_GOAL_RE.test(text)) return 0.4;
  return 0.1;
}

function riskAxis(text: string, goals: number): number {
  const tokens = estimateTokens(text);
  let score = 1;
  if (tokens > 40) score -= 0.15;
  if (tokens > 90) score -= 0.2;
  if (goals >= 3) score -= 0.3;
  else if (goals === 2) score -= 0.15;
  return clamp(score);
}

/**
 * Score one source text.
 *
 * @param text - the user's raw request.
 * @returns the axis scores, weighted total, and a decision with reasons.
 */
export function gate(text: string): GateResult {
  const trimmed = text.trim();
  const intent = detectIntent(trimmed);
  const tokens = estimateTokens(trimmed);
  const goals = countGoals(trimmed);
  const conversational = isConversational(trimmed);
  const sentences = splitSentences(trimmed);

  const axes: GateAxes = {
    goal: goalAxis(trimmed, intent),
    deliverable: deliverableAxis(trimmed, intent),
    context: contextAxis(trimmed),
    constraints: constraintAxis(trimmed),
    acceptance: acceptanceAxis(trimmed),
    risk: riskAxis(trimmed, goals),
  };

  let score = 0;
  for (const key of Object.keys(WEIGHTS) as (keyof GateAxes)[]) {
    score += axes[key] * WEIGHTS[key];
  }
  score = Number(score.toFixed(3));

  const reasons: string[] = [];
  let decision: GateResult['decision'] = score < COMPILE_THRESHOLD ? 'compile' : 'pass';

  if (conversational && tokens <= 14) {
    // A follow-up has no standalone meaning: restructuring it in isolation would
    // invent context the user did not supply. Pass it through untouched.
    return {
      decision: 'pass',
      score,
      axes,
      reasons: ['看起来是对话中的追问，脱离上文重写会失真，原样放行'],
      signals: { intent, tokens, goals, conversational },
    };
  }

  if (goals >= 3) reasons.push(`检测到 ${goals} 个并列任务，放在一轮里会互相稀释`);
  else if (goals === 2 && hasAdditiveConnector(trimmed)) reasons.push('两个任务用"同时/另外"连接，模型容易只做好一个');
  if (axes.goal < 0.5) reasons.push('没有明确动作，只有意图描述');
  if (intent !== 'answer' && !isQuestion(trimmed) && axes.deliverable < 0.4) reasons.push('没说要交付什么形态');
  if (axes.acceptance < 0.3 && tokens > 30) reasons.push('没有完成标准，模型只能自由发挥');
  if (sentences.length === 1 && tokens > 60) reasons.push('一句话塞了太多信息，拆成条目更稳');

  if (goals >= 3 || (goals === 2 && hasAdditiveConnector(trimmed))) decision = 'compile';

  reasons.push(
    decision === 'compile'
      ? `加权清晰度 ${score.toFixed(2)} 低于阈值 ${COMPILE_THRESHOLD}，值得先收束`
      : `加权清晰度 ${score.toFixed(2)} ≥ 阈值 ${COMPILE_THRESHOLD}，原样放行`,
  );

  return {
    decision,
    score,
    axes,
    reasons,
    signals: { intent, tokens, goals, conversational },
  };
}
