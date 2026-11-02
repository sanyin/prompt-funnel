/**
 * Language-agnostic text utilities: token estimation, sentence splitting, and
 * the hard-token extraction used by the fidelity check.
 *
 * Everything here is deterministic and dependency-free on purpose — the gate
 * has to run in well under a millisecond, and the fidelity check has to be
 * reproducible in review.
 *
 * @module prompt-funnel/text
 */

import type { HardToken } from './types.js';

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const CJK_TEST = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** True when the text contains CJK characters. */
export function hasCJK(text: string): boolean {
  return CJK_TEST.test(text);
}

/** CJK characters count as one token each; Latin words count as ~1.3. */
export function estimateTokens(text: string): number {
  const cjk = (text.match(CJK_RE) ?? []).length;
  const words = text.replace(CJK_RE, ' ').split(/\s+/).filter(Boolean).length;
  return cjk + Math.round(words * 1.3);
}

/**
 * Split into sentences without destroying identifiers.
 *
 * Only unambiguous terminators are used (CJK full stops, `!?;`, newlines) so
 * that `v1.2.3`, `main.ts`, and `example.com` survive intact.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[。！？!?；;])\s*/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Strip list markers and checkboxes so their digits are not read as literals. */
function stripMarkers(text: string): string {
  return text
    .replace(/^(\s*)(?:[-*+•]|\d+[.)、]|[①-⑳])\s+/gmu, '$1')
    .replace(/\[[ xX]\]/g, '');
}

/**
 * Extract literals a rewrite is not allowed to invent.
 *
 * Numbers are the highest-risk class (a hallucinated "3 seconds" or "80%"
 * changes the task), followed by quoted spans and code identifiers.
 */
export function extractHardTokens(text: string): HardToken[] {
  const cleaned = stripMarkers(text);
  const found = new Map<string, HardToken>();

  const add = (value: string, kind: HardToken['kind']): void => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    const key = trimmed.toLowerCase();
    if (!found.has(key)) found.set(key, { value: trimmed, kind });
  };

  for (const match of cleaned.matchAll(/https?:\/\/[^\s，。；、）)\]"'`]+/gu)) {
    add(match[0], 'url');
  }
  for (const match of cleaned.matchAll(/["“「『']([^"”」』'\n]{1,80})["”」』']/gu)) {
    add(match[1] ?? '', 'quoted');
  }
  // Paths and file names before generic identifiers, so `src/app.ts` stays whole.
  for (const match of cleaned.matchAll(
    /(?:[A-Za-z]:\\|\.{0,2}\/)?[\w.-]+(?:[/\\][\w.-]+)+|[\w-]+\.(?:ts|tsx|js|jsx|mjs|py|md|json|ya?ml|toml|vue|go|rs|java|c|cc|cpp|h|hpp|sh|txt|csv)\b/gu,
  )) {
    add(match[0], 'path');
  }
  for (const match of cleaned.matchAll(
    /\b(?:[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*|[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+|[A-Z]{2,}(?:_[A-Z0-9]+)+)\b/gu,
  )) {
    add(match[0], 'identifier');
  }
  for (const match of cleaned.matchAll(/\d+(?:\.\d+)*(?:%|v)?/gu)) {
    add(match[0], 'number');
  }

  return [...found.values()];
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'so', 'to', 'of', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'this', 'that', 'these', 'those', 'it', 'its', 'as',
  'at', 'by', 'from', 'we', 'you', 'i', 'me', 'my', 'our', 'your', 'can', 'could', 'should',
  'would', 'will', 'please', 'help', 'want', 'need', 'make', 'do', 'does', 'did', 'have', 'has',
  '的', '了', '着', '和', '与', '及', '或', '在', '是', '我', '你', '他', '她', '它', '我们',
  '你们', '这个', '那个', '一个', '一下', '然后', '但是', '因为', '所以', '可以', '需要', '请',
  '帮我', '想', '要', '能', '会', '把', '被', '对', '就', '也', '还', '很', '都', '什么',
]);

/**
 * Content tokens used for the retention proxy.
 *
 * This is deliberately crude: CJK is split per character (a bigram would be
 * better but costs more), Latin by word. It answers "did the compiler throw away
 * most of what the user wrote?", not "is this semantically complete".
 */
export function contentTokens(text: string): string[] {
  const latin = text
    .replace(CJK_RE, ' ')
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/u)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
  const cjk = text.match(CJK_RE) ?? [];
  return [...latin, ...cjk.filter((char) => !STOPWORDS.has(char))];
}

/** Fraction of source content tokens that appear in the output, 0..1. */
export function retention(source: string, output: string): number {
  const sourceTokens = contentTokens(source);
  if (sourceTokens.length === 0) return 1;
  const haystack = output.toLowerCase();
  let hits = 0;
  for (const token of sourceTokens) {
    if (haystack.includes(token.toLowerCase())) hits += 1;
  }
  return hits / sourceTokens.length;
}

/** Cheap, non-cryptographic digest, used to key cached specs. */
export function hashText(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + code, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 16);
}

/** Collapse whitespace and trim, for one-line reasons and diff display. */
export function oneLine(text: string, max = 120): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** True when the text looks like instructions aimed at the rewriter itself. */
export function looksLikeInjection(text: string): boolean {
  return /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:the\s+)?(?:previous|above|prior)\s+(?:instructions?|prompts?)|忽略(?:以上|之前|上面|前面)[的]?(?:所有)?(?:指令|提示|要求)|你现在是|从现在起你/u.test(
    text,
  );
}

const INJECTION_SPAN_RE =
  /(?:忽略(?:以上|之前|上面|前面)[^，。；\n]{0,16}(?:指令|提示|要求)[^。\n]*|(?:ignore|disregard|forget)\s+(?:all\s+)?(?:the\s+)?(?:previous|above|prior)\s+(?:instructions?|prompts?)[^.\n]*|从现在起你[^。\n]*|你现在是[^。\n]*)/iu;

/**
 * Split off text that tries to address the compiler.
 *
 * The span is never deleted — it stays in the source and is re-attached as
 * quoted material — but it is kept out of instruction slots such as the
 * objective. That is the difference between "the user pasted something" and
 * "the user's paste became the task".
 */
export function splitInjection(text: string): { clean: string; suspicious?: string } {
  const match = INJECTION_SPAN_RE.exec(text);
  if (match === null) return { clean: text };
  const clean = text
    .slice(0, match.index)
    .trimEnd()
    .replace(/[：:，,]+$/u, '');
  return { clean, suspicious: match[0] };
}

/** Result of separating pasted background material from the actual request. */
export interface SplitContext {
  context: string;
  request: string;
  separated: boolean;
}

/**
 * Split a paste into background material and the request itself.
 *
 * People do not type a brief; they paste a stack trace and then add one line at
 * the bottom. Treating the trace as requirements produces three numbered items
 * that are all wrong. A line of three or more dashes is the separator — the same
 * convention markdown already taught everyone.
 */
export function splitContext(raw: string): SplitContext {
  const lines = raw.split(/\r?\n/u);
  const index = lines.findIndex((line) => /^\s*-{3,}\s*$/u.test(line));
  if (index === -1) return { context: '', request: raw.trim(), separated: false };

  const context = lines.slice(0, index).join('\n').trim();
  const request = lines.slice(index + 1).join('\n').trim();
  // Dashes with nothing after them are not a separator, they are the message.
  if (request.length === 0) return { context: '', request: raw.trim(), separated: false };
  return { context, request, separated: true };
}
