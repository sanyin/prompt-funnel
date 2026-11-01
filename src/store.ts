/**
 * Local persistence.
 *
 * Every compile leaves a `.funnel/` directory next to the working copy: the spec
 * (so a later round can refine one section instead of starting over) and the
 * rendered prompt (so scripts can pipe it). It is gitignored by default because
 * it is scratch state, not output.
 *
 * @module prompt-funnel/store
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PromptSpec } from './types.js';

/** Directory for per-project funnel state. */
export function storeDir(cwd: string = process.cwd()): string {
  return join(cwd, '.funnel');
}

export function specPath(cwd?: string): string {
  return join(storeDir(cwd), 'last.json');
}

export function textPath(cwd?: string): string {
  return join(storeDir(cwd), 'last.md');
}

/** Persist a spec and its rendered text; returns the spec path. */
export function saveSpec(spec: PromptSpec, text: string, cwd?: string): string {
  const directory = storeDir(cwd);
  mkdirSync(directory, { recursive: true });
  writeFileSync(specPath(cwd), `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  writeFileSync(textPath(cwd), text, 'utf8');
  return specPath(cwd);
}

/** Load the last spec for this working copy, if it is intact. */
export function loadSpec(cwd?: string): PromptSpec | undefined {
  const path = specPath(cwd);
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const candidate = parsed as Partial<PromptSpec>;
    if (candidate.version !== '1' || candidate.meta === undefined) return undefined;
    return candidate as PromptSpec;
  } catch {
    return undefined;
  }
}

/** Load the last rendered text, if present. */
export function loadText(cwd?: string): string | undefined {
  const path = textPath(cwd);
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}
