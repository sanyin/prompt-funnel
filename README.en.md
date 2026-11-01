# prompt-funnel

[![ci](https://github.com/sanyin/prompt-funnel/actions/workflows/ci.yml/badge.svg)](https://github.com/sanyin/prompt-funnel/actions/workflows/ci.yml)
[![node](https://img.shields.io/badge/node-%E2%89%A522-339933)](package.json)
[![deps](https://img.shields.io/badge/runtime%20deps-0-blue)](package.json)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

> Make the missing information explicit before the request reaches the model. Ask what is worth asking, mark what was guessed, block what was invented.

[中文](./README.md) · [Design](./docs/DESIGN.md) · [Usage](./docs/USAGE.md) · [A/B report](./docs/AB-REPORT.md)

![playground](docs/assets/playground.png)

## The problem it actually solves

Most "the AI answered badly" cases are not a wording problem. They are one or two missing things among **objective, deliverable shape, constraints, acceptance criteria**. The model does not tell you what is missing — it picks a default and hands you something that looks professional and is not what you asked for.

A real pair, same request ("build me a crawler with a proxy pool and a dashboard"):

| Sent as-is | Sent after compiling |
| --- | --- |
| "Here is a complete, ready-to-run solution…" | "**Since you did not specify a target site**, I am using Python and httpbin.org/ip as a placeholder…" |
| 3000 characters of implementation, silent about its guesses | States up front what it decided for you |

Across 60 controlled calls, answers that **stated their own assumptions** went from **5/30 to 18/30**. Method, confounds, and what this does *not* prove: [docs/AB-REPORT.md](./docs/AB-REPORT.md).

## Quick start

```bash
npx prompt-funnel review "make it better"     # interactive: edit until you approve
npx prompt-funnel compile "make it better"    # just print the compiled prompt
npx prompt-funnel gate   "make it better"     # verdict only, change nothing
```

Zero runtime dependencies. No API key required. Works offline. Node ≥ 22.

Nothing to install: **https://sanyin.github.io/prompt-funnel/** (redeployed on every push; hard-refresh with Ctrl+Shift+R if your browser shows an old build).

## Six ways in

| Entry point | For | How |
| --- | --- | --- |
| **CLI** | terminals, scripts, pipes | `npx prompt-funnel review "..."` |
| **MCP** | any agent: DSH / Codex / Claude Code / Cursor | `npx -y prompt-funnel mcp` |
| **Hook** | automatic gating inside Claude Code | `funnel hook` ([setup](./adapters/claude-code/README.md)) |
| **Skill** | teaching an agent when to use it | `node adapters/install.mjs codex` |
| **Web** | try it without installing anything | `npm run playground` |
| **Extension** | fill in the gap inside ChatGPT / Claude / DeepSeek | `npm run build:extension` ([setup](./extension/README.md)) |

The MCP server only does deterministic work (gate / analyze / validate / render); **the semantic step is done by the host's own model**, so there is no second API key and no extra token spend. Six tools:

| Tool | What it does |
| --- | --- |
| `funnel_gate` | should this be compiled at all |
| `funnel_analyze` | raw text → structured spec |
| `funnel_render` | spec → final prompt, with the fidelity check |
| `funnel_continue` | follow-up: carry the agreed turn, analyse only the increment |
| `funnel_refine` | change one section ("make point 2 shorter") |
| `funnel_compile` | all of the above in one call |

## What it does / does not do

| Does | Does not |
| --- | --- |
| Decides whether to compile; clear requests pass **byte-for-byte** | Rewrite your wording (rewriting is where invention enters) |
| Separates objective / requirements / constraints / non-goals / acceptance | Decide scope, audience or stack for you |
| Marks guesses as assumptions, asks at most 3 questions | Make you fill in a form |
| Checks every literal in the output against the source | Trade your exact words for "better phrasing" |
| Carries agreed context into follow-ups | Guess what "continue" meant |

## See what you are about to send

The most common leak is not an attack, it is a paste: a log with `sk-...` still in it, a stack trace with `C:\Users\...`, an error message with a phone number.

All four surfaces scan for API keys, tokens, private keys, passwords, emails, phone numbers, ID numbers, internal IPs and local paths. When something matches it reports **how many, what kind, how long** — it never prints the secret itself (terminal history is an attack surface too), and never edits your text on its own.

You decide: a per-item "打码" button on the web and in the extension, `--redact` on the CLI, `--no-redact` to skip the scan.

Patterns are deliberately narrow: ports, versions, dates, short commit hashes and order numbers are asserted as non-findings. Missing one is better than being the tool that cried wolf.

## Hollow praise becomes a choice

Words like "competitive" or "novel" cannot be verified — a model will hand you something that merely *sounds* new and call it done. So they are pulled out into a question: is the novelty in mechanics, look, or technique — or "give me three directions first"?

Pick an axis and the constraint pins it. Pick the last option and a requirement is added: propose three directions, one line each, wait for a pick.

**The directions come from the model, not from this tool.** The rules engine invents nothing; it only turns "unverifiable" into "decidable".

## If you do not want flattery, make it an acceptance criterion

There is a **"要它说实话"** toggle in the page (template `critique` on the CLI).

It does not add "please do not be sycophantic" — a model satisfies that superficially: one sentence of agreement, a turn, and then the same answer. It adds checkable structure:

- conclusion first: viable / not viable / viable with conditions — no preamble
- disagree directly; no "although… but…" packaging that turns disagreement into agreement
- say "I am not sure" where you are not sure
- name at least one concrete reason this will fail

"Do not flatter" is an attitude. "Conclusion first plus one fatal risk" is an acceptance criterion. Only the second one can be checked, and only the second one changes the output.

## Four design decisions

**1. A gate, not a gateway.** Most messages are already clear, and rewriting them costs latency, tokens and trust. Clear requests are returned byte-for-byte identical — asserted in tests.

**2. The product is a structured object, not a string.** Every field records provenance: `user` / `inferred` / `assumption`. Anything not `user` renders with an `(assumed)` marker.

**3. Fidelity is checked deterministically.** A number, path or URL in the output that is absent from the source is an **error** with exit code 1, so CI can catch it. Do not ask the model whether it invented something; ask the source. Literals you type yourself in `funnel refine` are recorded in `meta.note` and accepted — they are your input, not invention.

**4. Follow-ups are continued, not re-derived.** "Add a test" has no standalone meaning. `funnel continue` puts the previous objective/requirements/deliverable in an "Already agreed" block and analyses only the new increment.

Why 总-分-总 (bottom line first, numbered middle, acceptance last): models use the **beginning and end** of a context best ([Lost in the Middle, TACL 2024](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00638/119630/Lost-in-the-Middle-How-Language-Models-Use-Long)), and adherence **falls as the number of simultaneous instructions rises** ([IFScale, 2025](https://huggingface.co/papers/2507.11538)). So the ask goes first, the done-state goes last, requirements are numbered and individually checkable, and going past 12 produces a warning instead of silent cramming. Full reasoning: [docs/DESIGN.md](./docs/DESIGN.md).

## How it works

```
raw text ──▶ gate ──pass──▶ sent unchanged (byte-identical)
              │
            compile
              ▼
     structure into a PromptSpec (provenance on every field)
       rules: extractive, offline, default
       api  : optional, abstractive, still validated
              ▼
     + intent template (code-review / debug / data-analysis / …)
     + previous turn, when this is a follow-up
              ▼
     render bluf / compact / checklist
              ▼
     fidelity: hard literals + retention
              ▼
     review: accept / edit / diff / refine one section
              ▼
            send + record
```

## Measured

**Offline suite** (16 labelled cases, no key, `npm run eval`):

| Metric | Result |
| --- | --- |
| Gate agreement with hand labels | 16/16 |
| Source content-word retention (median) | 100% |
| Invented literals | 0 |
| Length overhead (median) | 18 → 264 tokens |

**Live A/B** (deepseek-chat, 60 calls): assumptions stated 5/30 → 18/30; self-check language 2/30 → 17/30; about 258 extra input tokens per compiled request. Everything it does not prove is in [docs/AB-REPORT.md](./docs/AB-REPORT.md). No unmeasured numbers in this README.

**Cost**: the absolute overhead is **+105 to +245 tokens** depending on style; the default is the expensive one. Measured table, three tiers, and when not to use it: [docs/COST.md](./docs/COST.md). `funnel compile --budget 150` downgrades automatically and tells you.

## Layout

```
src/
  gate.ts        six-axis clarity score with human-readable reasons
  analyze.ts     extractive analysis: reorders and flags, never rewrites; gaps carry options
  questions.ts   gaps as clickable questions; answers fold into the right field
  redact.ts      secret/PII scan: keys, phones, internal IPs, local paths
  refine.ts      single-section edits
  session.ts     follow-up continuation
  templates.ts   intent templates supplying the missing done-state
  render.ts      three styles + provenance markers
  validate.ts    fidelity check + spec coercion
  hook.ts        Claude Code UserPromptSubmit hook (advisory / block / off)
  llm.ts         optional API engine (OpenAI-compatible)
  cli/           compile / review / refine / continue / gate / render / templates / config / hook
  mcp/           zero-dependency stdio MCP server, six tools
playground/      one static page: paste, answer, copy
  extension/       Chromium MV3, imports dist/ directly, requests no permissions
adapters/        skills and setup notes for Codex / DSH / Claude Code
evals/           16-case offline suite + live A/B harness
docs/            DESIGN / SPEC / USAGE / EVAL / AB-REPORT / EXAMPLE
```

## Known limits

- The rule engine does not understand semantics; it works from markers and will miss colloquial Chinese. It misses by *not flagging*, never by inventing — a drop shows up as a retention warning.
- A sentence that both constrains and acts ("rewrite this module in TypeScript") stays whole under Requirements.
- `refine` accepts eight explicit forms. When it does not understand, it lists them instead of guessing.
- Continuation is concatenation plus summarisation, not real dialogue understanding; after several turns the "already agreed" block grows and needs trimming.
- The Claude Code hook is provably invoked (a probe captured the real `UserPromptSubmit` payload), and `funnel hook` itself is unit-tested and answers in milliseconds; **whether the model adopts the injected structure is not measured** — that is up to the model.
- The live A/B covers one model, 10 cases, 3 samples; the quality dimension still needs human blind rating.
- **Secret detection is regex-based**: it catches common formats (sk-, ghp_, JWT, phone numbers, internal IPs) and nothing bespoke. It prefers missing a value to raising a false alarm — a user trained to dismiss warnings is worse off than one who missed a single leak.
- **The extension was only verified against a local fixture page**, never against the live sites; its composer heuristic depends on page structure and may break when a site changes (the failure mode is an unresponsive button, not a broken page).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The most valuable contributions are **new eval cases** and **finishing `rating.csv`**.

## License

MIT
