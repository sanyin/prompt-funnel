/**
 * Rendering a spec into the text that actually reaches the model.
 *
 * The default `bluf` style is the 总-分-总 shape, but for a reason rather than a
 * fashion: models use the beginning and the end of a context best, so the ask
 * goes first (bottom line up front) and the acceptance criteria go last (recency
 * on the checkable part). The middle is a flat numbered list, because numbered,
 * individually checkable items are followed more reliably than a paragraph.
 *
 * @module prompt-funnel/render
 */

import type { FidelityReport, Item, PromptSpec, RenderResult, StyleName } from './types.js';
import { renderLanguage } from './analyze.js';
import { checkFidelity } from './validate.js';

type Lang = 'zh' | 'en';

interface Labels {
  objective: string;
  context: string;
  requirements: string;
  constraints: string;
  nonGoals: string;
  deliverable: string;
  format: string;
  length: string;
  audience: string;
  acceptance: string;
  questions: string;
  original: string;
  assumed: string;
  defaults: string;
  ifWrong: string;
  colon: string;
  separator: string;
  carried: string;
}

const LABELS: Record<Lang, Labels> = {
  zh: {
    objective: '目标',
    context: '背景',
    requirements: '要求',
    constraints: '约束',
    nonGoals: '不要做',
    deliverable: '交付',
    format: '形式',
    length: '篇幅',
    audience: '受众',
    acceptance: '完成标准',
    questions: '待确认',
    original: '原文（与上文冲突时以此为准）',
    assumed: '假定',
    defaults: '以下条目未确认，按默认假设处理',
    ifWrong: '若不符',
    colon: '：',
    separator: '；',
    carried: '已确认（上一轮）',
  },
  en: {
    objective: 'Objective',
    context: 'Context',
    requirements: 'Requirements',
    constraints: 'Constraints',
    nonGoals: 'Out of scope',
    deliverable: 'Deliverable',
    format: 'Format',
    length: 'Length',
    audience: 'Audience',
    acceptance: 'Done when',
    questions: 'Open questions',
    original: 'Original request (authoritative if it conflicts)',
    assumed: 'assumed',
    defaults: 'Unconfirmed items are handled with these defaults',
    ifWrong: 'If not',
    colon: ': ',
    separator: '; ',
    carried: 'Already agreed (previous turn)',
  },
};

/** `label + value`, with the separator the language actually uses. */
const kv = (label: string, value: string, labels: Labels): string => `${label}${labels.colon}${value}`;

/** Append a provenance marker to anything the user did not literally write. */
function itemText(item: Item, labels: Labels): string {
  if (item.source === 'user') return item.text;
  return labels.colon === '：' ? `${item.text}（${labels.assumed}）` : `${item.text} (${labels.assumed})`;
}

/** Render one item as a markdown line, keeping multi-line content intact. */
function line(item: Item, labels: Labels): string {
  return itemText(item, labels).replace(/\n/gu, '\n  ');
}

function section(heading: string, body: string[]): string[] {
  return body.length === 0 ? [] : [`## ${heading}`, '', ...body, ''];
}

/** The default assumptions block, shared by every style. */
function assumptionBody(spec: PromptSpec, labels: Labels): string[] {
  const block: string[] = [];
  if (spec.openQuestions.length > 0) {
    block.push(`_${labels.defaults}${labels.colon}_`, '');
    spec.openQuestions.forEach((question, index) => block.push(`${index + 1}. ${question}`));
    block.push('');
  }
  if (spec.assumptions.length > 0) {
    block.push(`**${labels.assumed}**`, '');
    for (const assumption of spec.assumptions) {
      block.push(`- ${assumption.text} —— ${kv(labels.ifWrong, assumption.impact, labels)}`);
    }
  }
  return block;
}

function deliverableLines(spec: PromptSpec, labels: Labels): string[] {
  const out: string[] = [];
  if (spec.deliverable.format !== undefined) out.push(`- ${kv(labels.format, itemText(spec.deliverable.format, labels), labels)}`);
  if (spec.deliverable.length !== undefined) out.push(`- ${kv(labels.length, itemText(spec.deliverable.length, labels), labels)}`);
  if (spec.deliverable.audience !== undefined) out.push(`- ${kv(labels.audience, itemText(spec.deliverable.audience, labels), labels)}`);
  return out;
}

/** `bluf`: the fully structured 总-分-总 rendering. */
function renderBluf(spec: PromptSpec, labels: Labels): string[] {
  const out: string[] = [];
  if (spec.carried !== undefined) {
    out.push(`## ${labels.carried}`, '', spec.carried.text.trim(), '');
  }
  out.push(`## ${labels.objective}`, '', itemText(spec.objective, labels), '');

  out.push(...section(labels.context, spec.context.map((item) => `- ${line(item, labels)}`)));

  if (spec.requirements.length > 0) {
    out.push(`## ${labels.requirements}`, '');
    spec.requirements.forEach((requirement, index) => out.push(`${index + 1}. ${line(requirement, labels)}`));
    out.push('');
  }

  out.push(
    ...section(labels.constraints, spec.constraints.map((item) => `- ${line(item, labels)}`)),
    ...section(labels.nonGoals, spec.nonGoals.map((item) => `- ${line(item, labels)}`)),
    ...section(labels.deliverable, deliverableLines(spec, labels)),
    ...section(labels.acceptance, spec.acceptance.map((item) => `- [ ] ${line(item, labels)}`)),
  );

  if (spec.openQuestions.length > 0 || spec.assumptions.length > 0) {
    out.push(...section(labels.questions, assumptionBody(spec, labels)));
  }
  return out;
}

/** `compact`: for short requests where headers would outweigh the content. */
function renderCompact(spec: PromptSpec, labels: Labels): string[] {
  const out: string[] = [];
  if (spec.carried !== undefined) {
    out.push(`**${labels.carried}**${labels.colon}${spec.carried.text.replace(/\s*\n\s*/gu, ' / ')}`);
  }
  out.push(`**${labels.objective}**${labels.colon}${itemText(spec.objective, labels)}`);
  const bullet = (heading: string, values: string[]): void => {
    if (values.length > 0) out.push(`**${heading}**${labels.colon}${values.join(labels.separator)}`);
  };

  bullet(
    labels.requirements,
    spec.requirements.map((requirement, index) => `${index + 1}) ${line(requirement, labels)}`),
  );
  bullet(labels.constraints, spec.constraints.map((item) => line(item, labels)));
  bullet(labels.nonGoals, spec.nonGoals.map((item) => line(item, labels)));
  // In the compact style the sub-labels cost more than they explain.
  bullet(
    labels.deliverable,
    [spec.deliverable.format, spec.deliverable.length, spec.deliverable.audience]
      .filter((item): item is Item => item !== undefined)
      .map((item) => itemText(item, labels)),
  );
  bullet(labels.acceptance, spec.acceptance.map((item) => line(item, labels)));
  bullet(labels.questions, [...spec.openQuestions, ...spec.assumptions.map((item) => item.text)]);
  return out;
}

/** `checklist`: everything as checkboxes, for agent handoff. */
function renderChecklist(spec: PromptSpec, labels: Labels): string[] {
  const out: string[] = [];
  if (spec.carried !== undefined) {
    out.push(`**${labels.carried}**${labels.colon}${spec.carried.text.replace(/\s*\n\s*/gu, ' / ')}`, '');
  }
  out.push(`- [ ] ${kv(labels.objective, itemText(spec.objective, labels), labels)}`);
  for (const requirement of spec.requirements) out.push(`- [ ] ${line(requirement, labels)}`);
  for (const item of spec.constraints) out.push(`- [ ] ${kv(labels.constraints, line(item, labels), labels)}`);
  for (const item of spec.nonGoals) out.push(`- [ ] ${kv(labels.nonGoals, line(item, labels), labels)}`);
  for (const entry of deliverableLines(spec, labels)) out.push(`- [ ] ${entry.replace(/^- /u, '')}`);
  for (const item of spec.acceptance) out.push(`- [ ] ${kv(labels.acceptance, line(item, labels), labels)}`);
  if (spec.openQuestions.length > 0) {
    out.push(`- [ ] ${kv(labels.questions, spec.openQuestions.join('；'), labels)}`);
  }
  return out;
}

/**
 * `chat`: one message a person could actually send.
 *
 * The structured styles are a document. Most people are pasting into a chat box,
 * and a document is the wrong shape there — it reads as "you must learn to write
 * specs first". So this style keeps every fact and drops the scaffolding: no
 * headings, no checkboxes, no per-line provenance markers.
 *
 * Provenance is not dropped though: the closing line enumerates the defaults in
 * plain language, so an assumption still cannot pass as something the user said.
 */
function renderChat(spec: PromptSpec, labels: Labels): string[] {
  const zh = labels.colon === '：';
  const stop = zh ? '。' : '. ';
  const sep = zh ? '；' : '; ';
  const paragraphs: string[] = [];

  if (spec.context.length > 0) {
    const body = spec.context.map((item) => item.text.trim()).join(zh ? '\n' : '\n');
    paragraphs.push(`${labels.context}${labels.colon}${body}`);
  }

  let main = spec.objective.text.trim();
  if (spec.requirements.length > 0) {
    // No numbering here: this style is prose, and a list marker would also read
    // as an invented literal to the fidelity check.
    const body = spec.requirements.map((item) => item.text.trim()).join(sep);
    main += `${stop}${zh ? '另外还要' : 'Also'}${labels.colon}${body}`;
  }
  if (spec.constraints.length > 0) {
    main += `${stop}${labels.constraints}${labels.colon}${spec.constraints.map((item) => item.text.trim()).join(sep)}`;
  }
  paragraphs.push(main);

  const second: string[] = [];
  const deliverable = [spec.deliverable.format, spec.deliverable.length, spec.deliverable.audience].filter(
    (item): item is Item => item !== undefined,
  );
  if (deliverable.length > 0) {
    second.push(`${labels.deliverable}${labels.colon}${deliverable.map((item) => item.text.trim()).join(sep)}`);
  }
  // "不出现：X" is a negative criterion; it reads better as a wish than a checklist.
  const negative = spec.acceptance.filter((item) => item.text.startsWith('不出现：'));
  const positive = spec.acceptance.filter((item) => !item.text.startsWith('不出现：'));
  if (positive.length > 0) {
    const body = positive.map((item) => item.text.trim()).join(sep);
    second.push(zh ? `做到这些就算完成${labels.colon}${body}` : `${labels.acceptance}${labels.colon}${body}`);
  }
  if (negative.length > 0) {
    const body = negative.map((item) => item.text.replace(/^不出现：/u, '')).join(sep);
    second.push(zh ? `我最不想要的是${body}` : `What I least want is ${body}`);
  }
  if (second.length > 0) paragraphs.push(`${second.join(sep)}${stop}`);

  // The one place provenance survives: defaults are stated, in the user's voice,
  // as things the model may choose — not as things the user said.
  const said = paragraphs.join('\n');
  const fresh = spec.assumptions.filter((item) => !said.includes(item.text.trim()));
  if (fresh.length > 0) {
    const body = fresh.map((item) => item.text.trim()).join(sep);
    paragraphs.push(
      zh
        ? `没说的地方我先按这几条处理${labels.colon}${body}。不对的话告诉我，我改。`
        : `Where you have no instruction, use these defaults: ${body}. Tell me if any of that is wrong.`,
    );
  } else if (spec.openQuestions.length > 0) {
    paragraphs.push(
      zh
        ? '没交代的地方你按常见做法决定，但要说清楚你替我决定了什么。'
        : 'Where I have not said, decide for yourself — but say what you decided for me.',
    );
  }

  return [paragraphs.join('\n\n')];
}

/** Decide whether to re-attach the source text. */
export function shouldKeepOriginal(spec: PromptSpec, mode: 'auto' | 'on' | 'off'): boolean {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  // A continuation's source is the whole thread, and it grows every turn. The
  // carried block already states what was agreed, so re-attaching the transcript
  // is pure duplication — unless the caller deliberately carried nothing (which
  // means the host has the history) or there is code that exists nowhere else.
  if (spec.meta.carry === 'off') return false;
  if (spec.carried !== undefined) return spec.anchors.length > 0;
  return spec.anchors.length > 0 || spec.assumptions.length > 0 || spec.openQuestions.length > 0;
}

/** Render a spec to prompt text and check it against its own source. */
export function renderSpec(
  spec: PromptSpec,
  options: { style?: StyleName; keepOriginal?: 'auto' | 'on' | 'off' } = {},
): RenderResult {
  const style = options.style ?? spec.meta.style ?? 'bluf';
  const labels = LABELS[renderLanguage(spec.meta.source)];

  const body =
    style === 'chat'
      ? renderChat(spec, labels)
      : style === 'compact'
        ? renderCompact(spec, labels)
        : style === 'checklist'
          ? renderChecklist(spec, labels)
          : renderBluf(spec, labels);

  // A chat message with an appendix is not a chat message. Only an explicit
  // `on` re-attaches the source in this style.
  const keepMode = style === 'chat' ? (options.keepOriginal ?? 'off') : (options.keepOriginal ?? 'auto');
  const keptOriginal = shouldKeepOriginal(spec, keepMode);
  const text = body
    .filter((entry, index, array) => !(entry === '' && array[index - 1] === ''))
    .join('\n')
    .trimEnd();

  const withOriginal = keptOriginal
    ? `${text}\n\n---\n\n## ${labels.original}\n\n${spec.meta.source.trim()}\n`
    : `${text}\n`;

  // Fidelity is measured on the compiled body only: re-attaching the original
  // quote would make every invented literal look "found" in the source.
  const fidelity: FidelityReport = checkFidelity(spec, text);
  return { text: withOriginal, fidelity, keptOriginal };
}
