/**
 * Intent templates.
 *
 * The generic skeleton (objective / requirements / constraints / non-goals /
 * acceptance) is right for most work, but a code review and an image prompt have
 * different *done* criteria — and those criteria are exactly what a vague request
 * leaves out. A template supplies the missing defaults for one kind of task, so
 * they arrive as marked assumptions instead of being silently absent.
 *
 * Templates never add facts about the user's situation. They add expectations
 * about the shape of the answer, and every added line carries `assumption` or
 * `inferred` provenance so it can be seen and removed.
 *
 * @module prompt-funnel/templates
 */

import type { IntentClass, Item, PromptSpec, StyleName } from './types.js';

/** One task-specific skeleton. */
export interface Template {
  id: string;
  label: string;
  description: string;
  /** What this template understands the request to be. */
  intent?: IntentClass;
  style?: StyleName;
  deliverable?: string;
  constraints?: string[];
  acceptance?: string[];
  /** Asked instead of the generic questions when the template fits. */
  questions?: string[];
}

/** Built-in templates, keyed by id. */
export const TEMPLATES: Record<string, Template> = {
  default: {
    id: 'default',
    label: '通用',
    description: '不预设任务类型，按闸门判定生成通用骨架。',
  },
  'code-review': {
    id: 'code-review',
    label: '代码评审',
    description: '针对一段改动给出可逐条处理的评审意见。',
    intent: 'execute',
    deliverable: '一份可逐条处理的评审清单',
    constraints: ['只评审本次改动涉及的范围，不重写整个文件', '每一条指出具体位置与原因'],
    acceptance: ['按严重程度分组：阻断 / 建议 / 可选', '每条都给出可执行的修改方式'],
    questions: ['这次改动想解决什么问题？（判断是否偏题的前提）'],
  },
  debug: {
    id: 'debug',
    label: '排障',
    description: '从现象出发定位根因，并给出验证方式。',
    intent: 'debug',
    deliverable: '根因判断 + 修复方案 + 验证命令',
    constraints: ['先给最可能的原因和判定方法，再展开次要可能'],
    acceptance: ['给出能复现或能排除该原因的具体命令/步骤'],
    questions: ['完整的报错信息和触发步骤是什么？'],
  },
  'data-analysis': {
    id: 'data-analysis',
    label: '数据分析',
    description: '从数据问题到可复现的结论。',
    intent: 'execute',
    deliverable: '结论 + 可复现的查询或脚本',
    constraints: ['说明数据口径、时间范围与过滤条件'],
    acceptance: ['给出的查询/脚本能直接运行', '结论与数字对得上'],
    questions: ['数据来自哪里，口径是什么？（决定结论能不能信）'],
  },
  writing: {
    id: 'writing',
    label: '写作',
    description: '面向特定读者的成稿，而不是草稿。',
    intent: 'write',
    deliverable: '可直接使用的成稿',
    constraints: ['保持给定的事实与专有名词不变'],
    acceptance: ['没有占位符和未经核实的数字'],
  },
  'image-prompt': {
    id: 'image-prompt',
    label: '图像提示词',
    description: '把需求编译成可直接粘贴给图像模型的提示词。',
    intent: 'write',
    deliverable: '一段可直接粘贴到图像模型的提示词',
    constraints: ['包含主体、风格、构图/镜头、光照四个要素', '不要输出解释性文字'],
    acceptance: ['只有提示词本身，没有前后说明'],
  },
  research: {
    id: 'research',
    label: '调研',
    description: '把开放问题收成可执行的调研任务。',
    intent: 'plan',
    deliverable: '调研提纲 + 关键问题 + 判断标准',
    constraints: ['区分事实、推断与观点'],
    acceptance: ['每个结论都标明来源或标注为未经证实'],
    questions: ['这份调研用来做什么决定？（决定深度与取舍）'],
  },
};

/** Look up a template, falling back to `default` for unknown ids. */
export function getTemplate(id: string | undefined): Template {
  if (id === undefined) return TEMPLATES['default'] as Template;
  return TEMPLATES[id] ?? (TEMPLATES['default'] as Template);
}

/** Ids of every built-in template, in a stable order. */
export function templateIds(): string[] {
  return Object.keys(TEMPLATES);
}

const asItems = (values: string[] | undefined): Item[] =>
  (values ?? []).map((text) => ({ text, source: 'assumption' as const }));

/**
 * Apply a template to a spec.
 *
 * Template lines are appended, never substituted: if the user already said
 * something about acceptance, their words stay and the template's defaults sit
 * below them. The template also wins on `style` and fills a missing deliverable.
 */
export function applyTemplate(spec: PromptSpec, template: Template): PromptSpec {
  const next: PromptSpec = {
    ...spec,
    constraints: [...spec.constraints, ...asItems(template.constraints)],
    acceptance: [...spec.acceptance, ...asItems(template.acceptance)],
    deliverable: { ...spec.deliverable },
    openQuestions: [...spec.openQuestions],
    meta: { ...spec.meta, template: template.id },
  };

  if (template.intent !== undefined) next.intent = template.intent;
  if (template.style !== undefined) next.meta.style = template.style;
  if (template.deliverable !== undefined && next.deliverable.format?.source !== 'user') {
    next.deliverable.format = { text: template.deliverable, source: 'assumption' };
  }
  for (const question of template.questions ?? []) {
    if (next.openQuestions.length >= 3) break;
    if (!next.openQuestions.includes(question)) next.openQuestions.push(question);
  }

  return next;
}
