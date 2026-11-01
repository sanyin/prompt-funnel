/**
 * Secret and personal-data detection.
 *
 * Ordinary users paste their way into trouble: an error log with the API key
 * still in it, a screenshot-to-text with a phone number, a stack trace with
 * `C:\Users\someone\`. None of that is visible to them, and once it is sent it
 * has left the machine.
 *
 * Two rules shape this scanner:
 *  - **Never modify silently.** It reports; the caller decides. A tool that
 *    rewrites your text without saying so is a worse problem than the leak.
 *  - **Prefer missing to crying wolf.** A false positive trains people to click
 *    through warnings, which costs more than the rare miss. Every pattern here
 *    is deliberately narrow, and the tests assert the negative cases too.
 *
 * @module prompt-funnel/redact
 */

/** What kind of sensitive value was found. */
export type RedactKind =
  | 'api-key'
  | 'token'
  | 'private-key'
  | 'password'
  | 'email'
  | 'phone'
  | 'id-card'
  | 'ip'
  | 'path';

/** One span of text that should probably not be sent as-is. */
export interface Finding {
  kind: RedactKind;
  start: number;
  end: number;
  text: string;
  severity: 'high' | 'medium';
}

/** Human-readable label per kind, used in the replacement marker. */
const LABEL: Record<RedactKind, string> = {
  'api-key': 'api-key',
  token: 'token',
  'private-key': 'private-key',
  password: 'password',
  email: 'email',
  phone: 'phone',
  'id-card': 'id-card',
  ip: 'ip',
  path: 'path',
};

interface Rule {
  kind: RedactKind;
  severity: Finding['severity'];
  pattern: RegExp;
  /** Index of the capture group holding the sensitive part; 0 = whole match. */
  group?: number;
}

/**
 * Ordered high-confidence-first. A later rule that overlaps an earlier finding is
 * dropped, so `sk-...` inside a password assignment is reported once.
 */
const RULES: Rule[] = [
  {
    kind: 'private-key',
    severity: 'high',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
  },
  {
    kind: 'token',
    severity: 'high',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
  },
  { kind: 'api-key', severity: 'high', pattern: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/gu },
  { kind: 'api-key', severity: 'high', pattern: /\bghp_[A-Za-z0-9]{20,}\b/gu },
  { kind: 'api-key', severity: 'high', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gu },
  { kind: 'api-key', severity: 'high', pattern: /\bAKIA[0-9A-Z]{16}\b/gu },
  { kind: 'api-key', severity: 'high', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gu },
  { kind: 'api-key', severity: 'high', pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/gu },
  { kind: 'token', severity: 'high', pattern: /\bBearer\s+([A-Za-z0-9._~+/-]{12,}=*)/gu, group: 1 },
  {
    kind: 'password',
    severity: 'high',
    pattern:
      /(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\s*[:=]\s*["']?([^\s"',;]{6,})/giu,
    group: 1,
  },
  {
    kind: 'password',
    severity: 'high',
    pattern: /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+:[^/\s@]+)@/giu,
    group: 2,
  },
  { kind: 'email', severity: 'medium', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}\b/gu },
  { kind: 'phone', severity: 'medium', pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/gu },
  { kind: 'id-card', severity: 'medium', pattern: /(?<![\dA-Za-z])\d{17}[\dXx](?![\dA-Za-z])/gu },
  {
    kind: 'ip',
    severity: 'medium',
    // RFC1918 only. Each branch spells out its own octet count: a shared tail
    // would make 192.168.x.x match with five octets.
    pattern:
      /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/gu,
  },
  { kind: 'path', severity: 'medium', pattern: /\b[A-Za-z]:\\Users\\[^\\\s]+/gu },
  { kind: 'path', severity: 'medium', pattern: /\/(?:home|Users)\/[^/\s]+/gu },
];

/** Scan without changing anything. Findings are sorted and non-overlapping. */
export function scanSecrets(text: string): Finding[] {
  const found: Finding[] = [];

  for (const rule of RULES) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    for (const match of text.matchAll(pattern)) {
      const group = rule.group ?? 0;
      const value = match[group];
      if (value === undefined || value.length === 0) continue;
      const start = (match.index ?? 0) + (group === 0 ? 0 : match[0].indexOf(value));
      found.push({ kind: rule.kind, severity: rule.severity, start, end: start + value.length, text: value });
    }
  }

  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Finding[] = [];
  for (const finding of found) {
    const previous = kept[kept.length - 1];
    if (previous !== undefined && finding.start < previous.end) continue;
    kept.push(finding);
  }
  return kept;
}

/** The marker that replaces one finding. */
export function marker(kind: RedactKind): string {
  return `[REDACTED:${LABEL[kind]}]`;
}

/** Replace every finding in one pass. */
export function redactAll(text: string, findings: Finding[] = scanSecrets(text)): string {
  let out = '';
  let cursor = 0;
  for (const finding of findings) {
    out += text.slice(cursor, finding.start) + marker(finding.kind);
    cursor = finding.end;
  }
  return out + text.slice(cursor);
}

/**
 * Redact one finding by index, re-scanning first.
 *
 * Re-scanning avoids every off-by-one bug that position bookkeeping invites, and
 * a document with a handful of secrets is cheap to scan repeatedly.
 */
export function redactOne(text: string, index: number): string {
  const findings = scanSecrets(text);
  const target = findings[index];
  if (target === undefined) return text;
  return text.slice(0, target.start) + marker(target.kind) + text.slice(target.end);
}

/** Short label for UI, e.g. `API 密钥`. */
export function describe(kind: RedactKind, lang: 'zh' | 'en' = 'zh'): string {
  const zh: Record<RedactKind, string> = {
    'api-key': 'API 密钥',
    token: '令牌',
    'private-key': '私钥',
    password: '密码',
    email: '邮箱',
    phone: '手机号',
    'id-card': '身份证号',
    ip: '内网地址',
    path: '本机路径',
  };
  const en: Record<RedactKind, string> = {
    'api-key': 'API key',
    token: 'token',
    'private-key': 'private key',
    password: 'password',
    email: 'email',
    phone: 'phone number',
    'id-card': 'ID number',
    ip: 'internal IP',
    path: 'local path',
  };
  return lang === 'zh' ? zh[kind] : en[kind];
}
