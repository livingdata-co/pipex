// ---------------------------------------------------------------------------
// Shared pipeline domain types.
//
// These types are used by both the CLI runner and the kit system, and will
// also be consumed by future orchestrators (remote API, programmatic usage).
// ---------------------------------------------------------------------------

// -- Building blocks --------------------------------------------------------

/** Host-to-container bind mount (read-only at runtime). */
export type MountSpec = {
  /** Relative path from the pipeline file directory. */
  host: string;
  /** Absolute path inside the container. */
  container: string;
}

/** Reference to a previous step's artifact, mounted as read-only input. */
export type InputSpec = {
  /** ID of the step whose artifact to mount. */
  step: string;
  /** If true, the input artifact is copied into the output staging area before execution. */
  copyToOutput?: boolean;
}

/** Persistent read-write cache mount, shared across steps and executions. */
export type CacheSpec = {
  /** Cache name, scoped to the workspace (e.g. "npm-cache"). */
  name: string;
  /** Absolute mount path inside the container. */
  path: string;
}

// -- Resolved types (after kit resolution) ----------------------------------

/**
 * A fully resolved step, ready for execution.
 * Always has an explicit image and cmd — kit shorthand has already been expanded.
 */
export type Step = {
  id: string;
  image: string;
  cmd: string[];
  env?: Record<string, string>;
  inputs?: InputSpec[];
  /** Container path for the output artifact (default: "/output"). */
  outputPath?: string;
  caches?: CacheSpec[];
  mounts?: MountSpec[];
  timeoutSec?: number;
  /** When true the pipeline continues even if this step exits non-zero. */
  allowFailure?: boolean;
  /** When true the container gets network access (default: isolated). */
  allowNetwork?: boolean;
}

/** A pipeline whose steps have all been resolved. */
export type Pipeline = {
  name?: string;
  steps: Step[];
}

// -- Definition types (before kit resolution) -------------------------------

/**
 * A step defined via a kit: `uses` selects the kit, `with` passes parameters.
 * Mutually exclusive with Step (which requires image + cmd).
 *
 * All optional fields (env, caches, mounts…) merge with the kit's defaults,
 * with user-specified values taking priority.
 */
export type KitStepDefinition = {
  id: string;
  /** Kit name (e.g. "node", "python", "bash"). */
  uses: string;
  /** Kit-specific parameters (e.g. { version: "24", script: "build.js" }). */
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  inputs?: InputSpec[];
  outputPath?: string;
  caches?: CacheSpec[];
  mounts?: MountSpec[];
  timeoutSec?: number;
  allowFailure?: boolean;
  allowNetwork?: boolean;
}

/** A step definition with explicit image and cmd (same shape as a resolved Step). */
export type RawStepDefinition = Step

/** A step as written in the pipeline definition — either fully specified or using a kit. */
export type StepDefinition = RawStepDefinition | KitStepDefinition

/** A pipeline definition as written in JSON, before kit resolution. */
export type PipelineDefinition = {
  name?: string;
  steps: StepDefinition[];
}

/** Type guard: returns true when the step uses a kit (`uses` field present). */
export function isKitStep(step: StepDefinition): step is KitStepDefinition {
  return 'uses' in step && typeof step.uses === 'string'
}
