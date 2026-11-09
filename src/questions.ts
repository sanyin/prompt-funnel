/**
 * Inline questions.
 *
 * A gap in a request is only useful if it can be answered in one click. The
 * analyzer already decides *what* is missing and what default it would use; this
 * module turns those defaults into questions with concrete choices, and folds the
 * chosen answer back into the spec.
 *
 * Answering is a plain data edit — no model call, no free-text rewriting — so the
 * prompt stays a faithful record of what the user actually said.
 *
 * @module prompt-funnel/questions
 */

import type { AnswerValue, Assumption, PromptSpec, Requirement } from './types.js';

/** One answerable gap. */
export interface Question {
  id: string;
  question: string;
  options: string[];
  /** Several answers are legitimate (axes of novelty, delivery shapes). */
  multi?: boolean;
  /** The default that will be used if the question is skipped. */
  assumption: Assumption;
}

/** Every question still open for this spec, in the order they were raised. */
export function questionsFor(spec: PromptSpec): Question[] {
  const out: Question[] = [];
  for (const assumption of spec.assumptions) {
    if (assumption.gap === undefined) continue;
    out.push({
      id: assumption.gap.id,
      question: assumption.gap.question,
      options: assumption.gap.options,
      ...(assumption.gap.multi === true ? { multi: true } : {}),
      assumption,
    });
  }
  return out;
}

function renumber(requirements: Requirement[]): Requirement[] {
  return requirements.map((requirement, index) => ({ ...requirement, id: `R${index + 1}` }));
}

/** The "no opinion" option: answering it should not invent a criterion. */
const NO_FAILURE_STATED = /^(?:我也说不上来|I cannot say)$/u;

/** The option that asks the model to propose directions instead of committing. */
const ASK_FOR_OPTIONS = /^(?:先给我三个方向选|Give me three directions first)$/u;

/**
 * Fold one answer into the spec.
 *
 * The answer replaces the default it was raised against: the assumption and its
 * question disappear, and the chosen text lands in the section it belongs to,
 * marked `user` — it is the user's choice, not an inference.
 */
export function answerQuestion(spec: PromptSpec, id: string, answer: string | AnswerValue): PromptSpec {
  const values = (typeof answer === 'string' ? [answer] : answer.values).map((value) => value.trim()).filter(Boolean);
  const custom = typeof answer === 'string' ? undefined : answer.custom?.trim();
  // Typed text wins: it is the only part that is certainly the user's own words.
  const parts = custom !== undefined && custom.length > 0 ? [custom] : values;
  const text = parts.join('；');
  if (text.length === 0) return spec;

  const target = spec.assumptions.find((assumption) => assumption.gap?.id === id);
  if (target?.gap === undefined) return spec;

  const next: PromptSpec = {
    ...spec,
    requirements: renumber(spec.requirements),
    constraints: [...spec.constraints],
    acceptance: [...spec.acceptance],
    deliverable: { ...spec.deliverable },
    assumptions: spec.assumptions.filter((assumption) => assumption !== target),
    openQuestions: spec.openQuestions.filter((question) => question !== target.gap?.question),
    meta: { ...spec.meta },
  };
  const items = parts.map((part) => ({ text: part, source: 'user' as const }));
  const labels = { join: /[\u4e00-\u9fa5]/u.test(text) ? '、' : ', ' };

  switch (id) {
    case 'audience':
      next.deliverable.audience = { text, source: 'user' };
      break;
    case 'format':
      next.deliverable.format = { text, source: 'user' };
      break;
    case 'acceptance':
      next.acceptance.push(...items);
      break;
    case 'quality':
      // "Make it novel" cannot be verified. Either pin the axis, or ask the model
      // to propose directions before it starts building — never both.
      if (ASK_FOR_OPTIONS.test(text)) {
        next.requirements = renumber([
          ...next.requirements,
          { id: 'R?', text: '先给 3 个方向，各一句话说明取舍，等我选定再展开', source: 'user' },
        ]);
      } else {
        next.constraints.push({ text: `「新意 / 竞争力」的落点：${text}`, source: 'user' });
      }
      break;
    case 'failure':
      // A failure mode is an acceptance criterion in the negative: "this must not
      // happen". "I cannot say" is a real answer and adds nothing.
      for (const part of parts) {
        if (!NO_FAILURE_STATED.test(part)) next.acceptance.push({ text: `不出现：${part}`, source: 'user' });
      }
      break;
    case 'rubric':
      // A marking scheme is a constraint, not a requirement: it says what the
      // artefact must satisfy, not what to build.
      next.constraints.push({ text: `评分标准：${parts.join(labels.join)}`, source: 'user' });
      break;
    case 'forbidden':
      // "Do not touch X" belongs in out-of-scope, where the renderer shows it
      // separately from the work to be done.
      for (const part of parts) next.nonGoals.push({ text: part, source: 'user' });
      break;
    case 'repro':
      next.constraints.push({ text: `运行环境：${parts.join(labels.join)}`, source: 'user' });
      break;
    case 'scope':
      // Scope choices narrow the work; they belong with the constraints, not the
      // requirements, or they would be rendered as another thing to deliver.
      next.constraints.push(...items);
      break;
    case 'stack':
      next.constraints.push({ text: `技术栈：${text}`, source: 'user' });
      break;
    default:
      next.constraints.push(...items);
      break;
  }

  return next;
}

/** Apply a batch of answers, ignoring ones that no longer apply. */
export function answerAll(spec: PromptSpec, answers: Map<string, string>): PromptSpec {
  let next = spec;
  for (const [id, answer] of answers) next = answerQuestion(next, id, answer);
  return next;
}
