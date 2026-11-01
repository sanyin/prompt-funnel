/**
 * The hook's actual work, separated from its bin so the CLI can expose the same
 * behaviour as `funnel hook`.
 *
 * Stdin handling is the whole reason this file is async. A host is free to keep
 * the hook's stdin pipe open while it waits for the process to exit; a blocking
 * `readFileSync(0)` then deadlocks the session until the host's own timeout
 * fires. So the payload is collected until it parses, with a short hard deadline.
 *
 * @module prompt-funnel/hook-run
 */

import type { Readable } from 'node:stream';

import { safeRunHook } from './hook.js';
import type { HookMode, HookPayload } from './hook.js';

/** How long to wait for a complete payload before giving up on more input. */
export const PAYLOAD_DEADLINE_MS = 400;

function parses(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || !trimmed.startsWith('{')) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a JSON payload from a stream without requiring EOF.
 *
 * Resolves as soon as the buffer is a complete object, on `end`, or at the
 * deadline — whichever comes first.
 */
export function collectPayload(stream: Readable, deadlineMs = PAYLOAD_DEADLINE_MS): Promise<string> {
  return new Promise((resolve) => {
    let buffer = '';
    let settled = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeAllListeners('data');
      stream.removeAllListeners('end');
      stream.removeAllListeners('error');
      // Do not hold the process open on a pipe that will never close.
      if (typeof stream.pause === 'function') stream.pause();
      resolve(buffer);
    };

    const timer = setTimeout(finish, deadlineMs);

    stream.setEncoding?.('utf8');
    stream.on('data', (chunk: string) => {
      buffer += chunk;
      if (parses(buffer)) finish();
    });
    stream.on('end', finish);
    stream.on('error', finish);
  });
}

function parsePayload(raw: string): HookPayload {
  if (raw.trim().length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as HookPayload) : {};
  } catch {
    return {};
  }
}

function modeFromArgv(argv: string[]): HookMode | undefined {
  const index = argv.indexOf('--mode');
  const value = index === -1 ? undefined : argv[index + 1];
  return value === 'advisory' || value === 'block' || value === 'off' ? value : undefined;
}

/** Run once against stdin/stdout. Never throws. */
export async function runHookMain(argv: string[] = process.argv.slice(2)): Promise<void> {
  const raw = await collectPayload(process.stdin);
  const payload = parsePayload(raw);
  const mode = modeFromArgv(argv);
  const outcome = safeRunHook(payload, {
    ...(mode !== undefined ? { mode } : {}),
    force: argv.includes('--force'),
  });

  if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
  if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
  process.exitCode = outcome.exitCode;
}
