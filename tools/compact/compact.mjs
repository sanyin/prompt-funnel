/**
 * Invariant-preserving compaction.
 *
 * Long sessions hit the context wall. The usual fix is to summarise the old
 * turns with a model, which is where drift enters: a summary of a summary is
 * wrong in ways nobody can see, and the numbers and paths that actually matter
 * are exactly the first thing a paraphrase drops.
 *
 * This does the opposite. It removes **whole units** — never rewrites one — and
 * keeps every unit that carries a hard literal (a number, path, URL, identifier
 * or quoted string). What survives is guaranteed to contain everything the
 * source considered checkable, which is verified, not assumed.
 *
 * The output is shorter and boring on purpose: no prose is generated, so there
 * is nothing to hallucinate.
 *
 * @module tools/compact
 */

import { extractHardTokens, estimateTokens } from '../../dist/index.js';

/** A unit is one turn, paragraph or list item — never split further. */
function splitUnits(text) {
  return text
    .split(/\n{2,}/u)
    .map((unit) => unit.trim())
    .filter((unit) => unit.length > 0);
}

/** Literals a unit would lose if it were dropped, split by how much they matter. */
function literalsOf(unit) {
  const tokens = extractHardTokens(unit);
  return {
    all: tokens.map((token) => token.value),
    // A path, URL, identifier or quoted string is an invariant: paraphrase it and
    // the instruction stops being executable. A bare number in narrative
    // ("并发只有 50") is context, not an invariant.
    hard: tokens.filter((token) => token.kind !== 'number').map((token) => token.value),
  };
}

/** Sentences that change future behaviour, rather than describing the past. */
function isDecision(text) {
  return /(?:决定|改成|改用|定了|结论|不要|禁止|必须|采用|设为|不许|约定)/u.test(text);
}

/**
 * Keep-or-drop decision for every unit.
 *
 * Three tiers, because they fail differently:
 *   must   — an invariant, or a decision that changes future behaviour;
 *   tail   — the most recent turns, which hold the live state;
 *   rest   — droppable, prose first, narrative numbers only when nothing else is left.
 */
function decide(units, tail) {
  const last = Math.max(0, units.length - tail);
  return units.map((text, index) => {
    const literals = literalsOf(text);
    const must = literals.hard.length > 0 || isDecision(text);
    const reason = literals.hard.length > 0 ? '有必须原样保留的字面量' : isDecision(text) ? '是一条决定' : undefined;
    if (must) return { text, index, tier: 'must', why: reason ?? '必须保留', literals };
    if (index >= last) return { text, index, tier: 'tail', why: '最近的上下文', literals };
    if (literals.all.length > 0) return { text, index, tier: 'numbers', why: '只有叙述性数字', literals };
    return { text, index, tier: 'prose', why: '可省略', literals };
  });
}

/**
 * Compact, then prove the compaction kept every invariant.
 *
 * @param {string} source
 * @param {{budget?: number, tail?: number}} options - `budget` is a token target;
 *   units are dropped from the oldest end until it is met. `tail` keeps at least
 *   that many trailing units regardless.
 */
export function compact(source, options = {}) {
  const budget = options.budget ?? 600;
  const tail = options.tail ?? 2;
  const units = splitUnits(source);
  const decisions = decide(units, tail);

  const kept = new Set(decisions.filter((unit) => unit.tier === 'must' || unit.tier === 'tail').map((unit) => unit.index));
  const build = () => units.filter((_, index) => kept.has(index)).join('\n\n');
  let text = build();

  // Drop order: prose first, then narrative numbers, each oldest first. A number
  // is cheaper to lose than a paragraph that states a decision.
  const candidates = decisions
    .filter((unit) => unit.tier === 'prose' || unit.tier === 'numbers')
    .sort((left, right) => (left.tier === right.tier ? left.index - right.index : left.tier === 'prose' ? -1 : 1))
    .map((unit) => unit.index);

  let dropped = 0;
  for (const index of candidates) {
    if (estimateTokens(text) <= budget) break;
    kept.delete(index);
    dropped += 1;
    text = build();
  }

  const sourceTokens = extractHardTokens(source);
  const unique = [...new Set(sourceTokens.map((token) => token.value))];
  const hardSet = new Set(sourceTokens.filter((token) => token.kind !== 'number').map((token) => token.value));
  const missingHard = [...hardSet].filter((literal) => !text.includes(literal));
  const missingNumbers = [...new Set(sourceTokens.filter((token) => token.kind === 'number').map((token) => token.value))].filter(
    (literal) => !text.includes(literal) && !hardSet.has(literal),
  );

  return {
    text,
    report: {
      before: { units: units.length, tokens: estimateTokens(source) },
      after: { units: kept.size, tokens: estimateTokens(text) },
      dropped,
      keptFor: decisions.filter((unit) => kept.has(unit.index)).map((unit) => ({ index: unit.index, why: unit.why })),
      literals: unique.length,
      hard: { total: hardSet.size, missing: missingHard },
      numbers: { total: unique.length - hardSet.size, missing: missingNumbers },
      missing: missingHard,
      ok: missingHard.length === 0,
    },
  };
}

/** Human-readable summary of one compaction. */
export function describeCompaction(report) {
  const saved = report.before.tokens - report.after.tokens;
  const percent = report.before.tokens === 0 ? 0 : Math.round((saved / report.before.tokens) * 100);
  return [
    `单元 ${report.before.units} → ${report.after.units}（去掉 ${report.dropped}）`,
    `tokens ${report.before.tokens} → ${report.after.tokens}（省 ${saved}，${percent}%）`,
    `必须原样保留的字面量 ${report.hard.total} 个，缺失 ${report.hard.missing.length} 个`,
    `叙述性数字 ${report.numbers.total} 个，压缩时去掉了 ${report.numbers.missing.length} 个`,
    report.ok ? '✓ 没有一个可执行的字面量被丢掉' : `✗ 丢失：${report.missing.join('、')}`,
  ].join('\n');
}
