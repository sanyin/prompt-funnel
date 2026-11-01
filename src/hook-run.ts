/**
 * The hook's actual work, separated from its bin so the CLI can expose the same
 * behaviour as `funnel hook` (needed because `npx prompt-funnel hook` is the
 * simplest thing to put in a host's settings file).
 *
 * @module prompt-funnel/hook-run
 */

import { readFileSync } from 'node:fs';

import { safeRunHook } from './hook.js';
import type { HookMode, HookPayload } from './hook.js';

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
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
export function runHookMain(argv: string[] = process.argv.slice(2)): void {
  const payload = parsePayload(readStdin());
  const mode = modeFromArgv(argv);
  const outcome = safeRunHook(payload, {
    ...(mode !== undefined ? { mode } : {}),
    force: argv.includes('--force'),
  });

  if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout);
  if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr);
  process.exitCode = outcome.exitCode;
}
