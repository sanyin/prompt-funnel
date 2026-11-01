#!/usr/bin/env node
/**
 * Assemble the browser extension.
 *
 * The extension runs the *same* core as the CLI: this script copies `dist/` into
 * `extension/core/` and syncs the manifest version from package.json. No bundler
 * and no second implementation, so the panel cannot drift from the tool.
 *
 *   node scripts/build-extension.mjs
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');
const extension = join(root, 'extension');
const core = join(extension, 'core');

if (!existsSync(join(dist, 'analyze.js'))) {
  console.error('dist/ 不存在或不完整，先运行 npm run build');
  process.exit(2);
}

rmSync(core, { recursive: true, force: true });
mkdirSync(core, { recursive: true });

// Only the browser-safe modules: the CLI, MCP server and config read files.
const NEEDED = [
  'analyze.js',
  'gate.js',
  'render.js',
  'validate.js',
  'questions.js',
  'redact.js',
  'signals.js',
  'templates.js',
  'text.js',
  'types.js',
  'diff.js',
  'refine.js',
  'session.js',
];
for (const file of NEEDED) {
  const source = join(dist, file);
  if (!existsSync(source)) {
    console.error(`缺少 ${file}，先运行 npm run build`);
    process.exit(2);
  }
  cpSync(source, join(core, file));
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const manifestPath = join(extension, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = pkg.version;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`扩展已就绪：${extension}`);
console.log(`  版本 ${pkg.version}，内核模块 ${NEEDED.length} 个`);
console.log('  加载方式：chrome://extensions → 打开开发者模式 → 加载已解压的扩展程序 → 选这个目录');
