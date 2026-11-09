/**
 * Configuration: file first, environment second, defaults last.
 *
 * Deliberately boring. The only interesting part is `engine: auto`, which is
 * what makes the tool usable with no key at all: rules when nothing is
 * configured, the API when it is.
 *
 * @module prompt-funnel/config
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { EngineName, StyleName } from './types.js';

/** Persisted settings. */
export interface FunnelConfig {
  engine: 'auto' | EngineName;
  style: StyleName;
  api: {
    baseUrl: string;
    model: string;
    apiKeyEnv: string;
    timeoutMs: number;
  };
}

const DEFAULTS: FunnelConfig = {
  engine: 'auto',
  style: 'bluf',
  api: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    timeoutMs: 20_000,
  },
};

/** Directory holding persistent funnel state (`last.json`, `config.json`). */
export function funnelHome(): string {
  return process.env['FUNNEL_HOME'] ?? join(homedir(), '.funnel');
}

/** Path of the config file, honoring `FUNNEL_CONFIG`. */
export function configPath(): string {
  return process.env['FUNNEL_CONFIG'] ?? join(funnelHome(), 'config.json');
}

function merge(base: FunnelConfig, patch: unknown): FunnelConfig {
  if (typeof patch !== 'object' || patch === null) return base;
  const record = patch as Record<string, unknown>;
  const api = (typeof record['api'] === 'object' && record['api'] !== null ? record['api'] : {}) as Record<string, unknown>;
  const engine = record['engine'];
  const style = record['style'];
  return {
    engine:
      engine === 'auto' || engine === 'rules' || engine === 'api' || engine === 'host'
        ? (engine as FunnelConfig['engine'])
        : base.engine,
    style: style === 'bluf' || style === 'compact' || style === 'checklist' || style === 'chat' || style === 'template' ? style : base.style,
    api: {
      baseUrl: typeof api['baseUrl'] === 'string' ? api['baseUrl'] : base.api.baseUrl,
      model: typeof api['model'] === 'string' ? api['model'] : base.api.model,
      apiKeyEnv: typeof api['apiKeyEnv'] === 'string' ? api['apiKeyEnv'] : base.api.apiKeyEnv,
      timeoutMs: typeof api['timeoutMs'] === 'number' ? api['timeoutMs'] : base.api.timeoutMs,
    },
  };
}

/** Read config, applying environment overrides. */
export function loadConfig(): FunnelConfig {
  let config = { ...DEFAULTS };
  const path = configPath();
  if (existsSync(path)) {
    try {
      config = merge(config, JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      // A corrupt config must never break the CLI; fall back to defaults.
    }
  }
  if (process.env['FUNNEL_ENGINE'] !== undefined) config = merge(config, { engine: process.env['FUNNEL_ENGINE'] });
  if (process.env['FUNNEL_STYLE'] !== undefined) config = merge(config, { style: process.env['FUNNEL_STYLE'] });
  config = merge(config, {
    api: {
      ...(process.env['FUNNEL_API_BASE'] !== undefined ? { baseUrl: process.env['FUNNEL_API_BASE'] } : {}),
      ...(process.env['FUNNEL_MODEL'] !== undefined ? { model: process.env['FUNNEL_MODEL'] } : {}),
    },
  });
  return config;
}

/** Write a partial config object, merging into whatever is on disk. */
export function saveConfig(patch: Record<string, unknown>): FunnelConfig {
  const path = configPath();
  let current: unknown = {};
  if (existsSync(path)) {
    try {
      current = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      current = {};
    }
  }
  const next = merge(merge(DEFAULTS, current), patch);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

/** The API key, in priority order: explicit override, configured var, common vars. */
export function resolveApiKey(config: FunnelConfig): string | undefined {
  const candidates = [
    process.env['FUNNEL_API_KEY'],
    process.env[config.api.apiKeyEnv],
    process.env['OPENAI_API_KEY'],
    process.env['DEEPSEEK_API_KEY'],
  ];
  return candidates.find((value): value is string => typeof value === 'string' && value.length > 0);
}

/**
 * Pick the engine that will actually run.
 *
 * `auto` means: rules unless a key exists. That keeps the zero-config path fast
 * and offline, and keeps the API path opt-in by accident of having a key.
 */
export function resolveEngine(requested: FunnelConfig['engine'] | undefined, config: FunnelConfig): EngineName {
  const choice = requested ?? config.engine;
  if (choice === 'rules' || choice === 'api' || choice === 'host') return choice;
  return resolveApiKey(config) !== undefined ? 'api' : 'rules';
}

