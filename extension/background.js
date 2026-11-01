/**
 * Extension service worker: runs the same core as the CLI and the web page.
 *
 * The core is pure ESM with relative imports, so `scripts/build-extension.mjs`
 * copies `dist/` into `extension/core/` and this file imports it directly. No
 * bundler, no second implementation to drift.
 *
 * @module prompt-funnel/extension/background
 */

import { analyzeWithRules } from './core/analyze.js';
import { gate } from './core/gate.js';
import { questionsFor, answerQuestion } from './core/questions.js';
import { scanSecrets } from './core/redact.js';
import { renderSpec } from './core/render.js';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'funnel:analyze') return undefined;
  try {
    const text = String(message.text ?? '');
    const verdict = gate(text);
    let spec = analyzeWithRules(text, verdict);
    for (const [id, answer] of message.answers ?? []) spec = answerQuestion(spec, id, String(answer));

    // A clear request is sent as-is; showing questions would be noise.
    const questions = verdict.decision === 'pass' ? [] : questionsFor(spec);
    const rendered = renderSpec(spec, {});
    sendResponse({
      ok: true,
      decision: verdict.decision,
      questions,
      prompt: verdict.decision === 'pass' ? text : rendered.text,
      secrets: scanSecrets(text).map((finding) => ({ kind: finding.kind, length: finding.text.length })),
    });
  } catch (error) {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
  return undefined;
});
