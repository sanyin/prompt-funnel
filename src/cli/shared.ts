/**
 * CLI plumbing: argument parsing and terminal styling.
 *
 * Hand-rolled on purpose: the CLI is the thing users pipe into scripts, so it
 * must start instantly and depend on nothing.
 *
 * @module prompt-funnel/cli/shared
 */

/** Parsed command line. */
export interface Args {
  command: string;
  /** Non-flag arguments, in order. */
  words: string[];
  flags: Map<string, string | true>;
}

/** Parse `funnel <command> [words...] [--flag[=value]]`. */
export function parseArgs(argv: string[]): Args {
  const command = argv[0] ?? 'help';
  const words: string[] = [];
  const flags = new Map<string, string | true>();

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (token === '--') {
      words.push(...argv.slice(index + 1));
      break;
    }
    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        flags.set(body.slice(0, eq), body.slice(eq + 1));
        continue;
      }
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags.set(body, next);
        index += 1;
        continue;
      }
      flags.set(body, true);
      continue;
    }
    if (token === '-h') {
      flags.set('help', true);
      continue;
    }
    if (token === '-v') {
      flags.set('version', true);
      continue;
    }
    words.push(token);
  }
  return { command, words, flags };
}

/** Read a string flag, or undefined. */
export function flagValue(args: Args, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

/** Read a boolean flag. */
export function flagOn(args: Args, name: string): boolean {
  return args.flags.has(name);
}

const COLORS = process.env['NO_COLOR'] === undefined && process.stdout.isTTY === true;

/** Style helpers that degrade to plain text when not on a TTY. */
export const paint = {
  dim: (text: string): string => (COLORS ? `\u001b[2m${text}\u001b[0m` : text),
  bold: (text: string): string => (COLORS ? `\u001b[1m${text}\u001b[0m` : text),
  green: (text: string): string => (COLORS ? `\u001b[32m${text}\u001b[0m` : text),
  yellow: (text: string): string => (COLORS ? `\u001b[33m${text}\u001b[0m` : text),
  red: (text: string): string => (COLORS ? `\u001b[31m${text}\u001b[0m` : text),
  cyan: (text: string): string => (COLORS ? `\u001b[36m${text}\u001b[0m` : text),
};

/** Diagnostics go to stderr so `funnel compile | pbcopy` stays clean. */
export function note(message: string): void {
  process.stderr.write(`${message}\n`);
}
