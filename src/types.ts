/**
 * Core data model.
 *
 * The unit of work is not a string, it is a {@link PromptSpec}: a structured
 * object where every field records where it came from. That provenance is what
 * keeps a rewrite honest — anything the user did not say is either marked as an
 * assumption or turned into a question, never smuggled in as fact.
 *
 * @module prompt-funnel/types
 */

/** What kind of request the source text appears to be. */
export type IntentClass = 'execute' | 'answer' | 'debug' | 'write' | 'plan' | 'unknown';

/**
 * Where a field value came from.
 *
 * - `user` — copied from the source text (possibly reordered, never reworded).
 * - `inferred` — derived from the source by a rule (e.g. "this is a question,
 *   so the deliverable is an answer"). Rendered with an `(assumed)` marker.
 * - `assumption` — not derivable; a default we picked. Listed for review.
 */
export type Provenance = 'user' | 'inferred' | 'assumption';

/** One piece of prompt content plus its provenance. */
export interface Item {
  text: string;
  source: Provenance;
}

/** A numbered requirement. */
export interface Requirement extends Item {
  /** Stable within a spec, `R1`..`Rn`. */
  id: string;
}

/** A stated default plus what breaks if it is wrong. */
export interface Assumption {
  text: string;
  impact: string;
}

/** A high-risk literal that a rewrite must not invent. */
export interface HardToken {
  value: string;
  kind: 'number' | 'quoted' | 'identifier' | 'url' | 'path';
}

/** Per-axis clarity, each 0..1 where 1 is unambiguous. */
export interface GateAxes {
  goal: number;
  deliverable: number;
  context: number;
  constraints: number;
  acceptance: number;
  /** How contained the blast radius is. */
  risk: number;
}

/** Gate verdict for one source text. */
export interface GateResult {
  /** `pass` means "send it as it is"; `compile` means "worth restructuring". */
  decision: 'pass' | 'compile';
  /** Weighted clarity, 0..1. */
  score: number;
  axes: GateAxes;
  reasons: string[];
  signals: {
    intent: IntentClass;
    tokens: number;
    /** Distinct action-bearing sentences. */
    goals: number;
    /** Looks like a reply in an ongoing conversation, not a standalone ask. */
    conversational: boolean;
  };
}

/** Delivery shape of the work. */
export interface Deliverable {
  format?: Item;
  length?: Item;
  audience?: Item;
}

/** Machine-readable analysis of one request. */
export interface PromptSpec {
  version: '1';
  intent: IntentClass;
  objective: Item;
  context: Item[];
  requirements: Requirement[];
  constraints: Item[];
  nonGoals: Item[];
  deliverable: Deliverable;
  acceptance: Item[];
  assumptions: Assumption[];
  openQuestions: string[];
  /** Verbatim spans that must survive compilation unchanged. */
  anchors: string[];
  meta: SpecMeta;
}

/** Who produced a spec and how. */
export interface SpecMeta {
  gate: GateResult;
  engine: EngineName;
  style: StyleName;
  source: string;
  sourceHash: string;
  createdAt: string;
  /** Free-form refinement note from the last round, if any. */
  note?: string;
}

/** Which analyzer produced the spec. */
export type EngineName = 'rules' | 'api' | 'host';

/** Rendering style. */
export type StyleName = 'bluf' | 'compact' | 'checklist';

/** One problem found while validating a spec or its rendering. */
export interface Issue {
  kind:
    | 'unverifiable-token'
    | 'low-retention'
    | 'too-many-requirements'
    | 'empty-objective'
    | 'no-acceptance'
    | 'no-question-mark'
    | 'injection-suspected';
  detail: string;
  severity: 'error' | 'warn';
}

/** Result of the deterministic fidelity check. */
export interface FidelityReport {
  /** Share of source content tokens that survived into the prompt, 0..1. */
  retention: number;
  /** Literals present in the output but absent from the source. */
  unverifiable: string[];
  issues: Issue[];
  /** True when nothing at `error` severity was found. */
  ok: boolean;
}

/** A rendered prompt plus its fidelity report. */
export interface RenderResult {
  text: string;
  fidelity: FidelityReport;
  /** True when the original text was re-attached as an authoritative quote. */
  keptOriginal: boolean;
}

/** Options accepted by {@link compile}. */
export interface CompileOptions {
  engine?: EngineName | 'auto';
  style?: StyleName;
  /** Recorded in `meta.note`; steers the API engine and some rules tweaks. */
  note?: string;
  /** Skip the gate and always compile. */
  force?: boolean;
  /** Re-attach the source text: `auto` only when assumptions or questions exist. */
  keepOriginal?: 'auto' | 'on' | 'off';
  now?: string;
}

/** Result of a full compile pass. */
export interface CompileResult {
  spec: PromptSpec;
  rendered: RenderResult;
  /** True when the gate decided the source was already clear. */
  passedThrough: boolean;
  notes: string[];
}
