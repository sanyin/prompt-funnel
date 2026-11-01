/**
 * The optional API engine: one OpenAI-compatible chat completion that returns a
 * spec-shaped JSON object.
 *
 * The system prompt is doing real work here. Its whole job is to forbid the
 * failure mode everyone expects from a rewriter — inventing plausible
 * requirements — and to route every guess into `assumptions` or `openQuestions`.
 * The output is still checked by {@link coerceSpec} and the fidelity pass, so a
 * disobedient model degrades to the rule-based result instead of shipping noise.
 *
 * @module prompt-funnel/llm
 */

import type { PromptSpec } from './types.js';

/** Where and how to call the model. */
export interface ApiTarget {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

const SYSTEM_PROMPT = `You are a prompt compiler for a coding/agent assistant.
Convert the user's raw request into a JSON spec. Hard rules:
1. Use ONLY information present in the request. Never add facts, names, numbers, versions, file paths, technologies, or requirements that are not stated or unambiguously implied.
2. Preserve the user's own wording. You may reorder and split; you may not paraphrase meaning.
3. Anything you would have to guess goes into "assumptions" (with an "impact" sentence) or "openQuestions". Never silently pick a default.
4. Copy fenced code, quoted strings, identifiers and numbers verbatim.
5. Write all text in the same language as the request.
6. At most 12 requirements; each must be a single checkable statement.
7. "source" is "user" when the text is the user's own words, "inferred" when you derived it by a rule.

Return ONLY a JSON object with these keys:
{
  "intent": "execute|answer|debug|write|plan|unknown",
  "objective": {"text": string, "source": "user|inferred"},
  "context": [{"text": string, "source": "user|inferred"}],
  "requirements": [{"text": string, "source": "user|inferred"}],
  "constraints": [{"text": string, "source": "user|inferred"}],
  "nonGoals": [{"text": string, "source": "user|inferred"}],
  "deliverable": {"format": {...}, "length": {...}, "audience": {...}},
  "acceptance": [{"text": string, "source": "user|inferred|assumption"}],
  "assumptions": [{"text": string, "impact": string}],
  "openQuestions": [string]
}`;

/** Strip markdown fences and isolate the outermost JSON object. */
export function extractJson(raw: string): unknown {
  const withoutFence = raw
    .replace(/^\s*```(?:json)?\s*/iu, '')
    .replace(/```\s*$/u, '')
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('model did not return JSON');
    return JSON.parse(withoutFence.slice(start, end + 1));
  }
}

/** Compact baseline handed to the model so it does not re-derive everything. */
function baselineForPrompt(spec: PromptSpec): string {
  return JSON.stringify(
    {
      intent: spec.intent,
      objective: spec.objective.text,
      requirements: spec.requirements.map((requirement) => requirement.text),
      constraints: spec.constraints.map((item) => item.text),
      nonGoals: spec.nonGoals.map((item) => item.text),
      acceptance: spec.acceptance.map((item) => item.text),
    },
    null,
    0,
  );
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

/**
 * Ask the model for a spec.
 *
 * Retries once without `response_format` because some OpenAI-compatible servers
 * reject it; that failure mode is common enough to handle rather than surface.
 */
export async function requestSpec(
  target: ApiTarget,
  raw: string,
  baseline: PromptSpec,
  note?: string,
): Promise<unknown> {
  const endpoint = `${target.baseUrl.replace(/\/+$/u, '')}/chat/completions`;
  const userContent = [
    'Request:',
    '<<<',
    raw,
    '>>>',
    '',
    'Baseline analysis from a rule engine (may be incomplete; correct it, do not invent):',
    baselineForPrompt(baseline),
    note !== undefined && note.trim().length > 0 ? `\nRefinement note from the user: ${note.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const call = async (withJsonMode: boolean): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), target.timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${target.apiKey}`,
        },
        body: JSON.stringify({
          model: target.model,
          temperature: 0.2,
          max_tokens: 1500,
          ...(withJsonMode ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP ${response.status}: ${body.slice(0, 240)}`);
      }
      const payload = (await response.json()) as ChatResponse;
      if (payload.error !== undefined) throw new Error(payload.error.message ?? 'model error');
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim().length === 0) {
        throw new Error('empty completion');
      }
      return extractJson(content);
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await call(true);
  } catch (error) {
    // Retry only for shapes a server is likely to reject for the mode flag.
    const message = error instanceof Error ? error.message : String(error);
    if (!/HTTP 4\d\d/u.test(message)) throw error;
    return await call(false);
  }
}
