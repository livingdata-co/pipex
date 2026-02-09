import {readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'

/**
 * Cached execution state for a single step.
 */
export type StepState = {
  /** Artifact ID produced by the step */
  artifactId: string;
  /** SHA256 fingerprint of step configuration (image + cmd + env + inputs) */
  fingerprint: string;
}

/**
 * Workspace state containing all cached step results.
 * Persisted as state.json in the workspace directory.
 */
export type PipelineState = {
  /** Map of step ID to cached state */
  steps: Record<string, StepState>;
}

/**
 * Manages caching state for pipeline execution.
 *
 * The StateManager computes fingerprints for steps and tracks which
 * artifact was produced by each step. This enables cache hits when
 * a step's configuration hasn't changed.
 *
 * ## Fingerprint Algorithm
 *
 * A step fingerprint is computed as:
 * ```
 * SHA256(image + JSON(cmd) + JSON(sorted env) + JSON(sorted inputArtifactIds))
 * ```
 *
 * A step is re-executed when:
 * - The fingerprint changes (image, cmd, env, or inputs modified)
 * - The artifact no longer exists (manually deleted)
 *
 * ## Cache Propagation
 *
 * Changes propagate through dependencies. If step A is modified,
 * all steps depending on A are invalidated automatically (via inputArtifactIds).
 */
export class StateManager {
  static fingerprint(config: {
    image: string;
    cmd: string[];
    env?: Record<string, string>;
    inputArtifactIds?: string[];
    mounts?: Array<{hostPath: string; containerPath: string}>;
  }): string {
    const hash = createHash('sha256')
    hash.update(config.image)
    hash.update(JSON.stringify(config.cmd))
    if (config.env) {
      hash.update(JSON.stringify(Object.entries(config.env).sort((a, b) => a[0].localeCompare(b[0]))))
    }

    if (config.inputArtifactIds) {
      hash.update(JSON.stringify([...config.inputArtifactIds].sort((a, b) => a.localeCompare(b))))
    }

    if (config.mounts && config.mounts.length > 0) {
      const sorted = [...config.mounts].sort((a, b) => a.containerPath.localeCompare(b.containerPath))
      hash.update(JSON.stringify(sorted))
    }

    return hash.digest('hex')
  }

  private readonly state: PipelineState = {steps: {}}
  private readonly path: string

  /**
   * Creates a state manager for the given workspace.
   * @param workspaceRoot - Absolute path to workspace directory
   */
  constructor(workspaceRoot: string) {
    this.path = join(workspaceRoot, 'state.json')
  }

  /**
   * Loads cached state from state.json.
   * If the file doesn't exist, initializes with empty state.
   */
  async load(): Promise<void> {
    try {
      const content = await readFile(this.path, 'utf8')
      Object.assign(this.state, JSON.parse(content) as PipelineState)
    } catch {
      this.state.steps = {}
    }
  }

  /**
   * Persists current state to state.json.
   */
  async save(): Promise<void> {
    await writeFile(this.path, JSON.stringify(this.state, null, 2), 'utf8')
  }

  /**
   * Retrieves cached state for a step.
   * @param stepId - Step identifier
   * @returns Cached state if available, undefined otherwise
   */
  getStep(stepId: string): StepState | undefined {
    return this.state.steps[stepId]
  }

  /**
   * Updates cached state for a step.
   * @param stepId - Step identifier
   * @param artifactId - Artifact produced by the step
   * @param fingerprint - Step configuration fingerprint
   */
  setStep(stepId: string, artifactId: string, fingerprint: string): void {
    this.state.steps[stepId] = {artifactId, fingerprint}
  }
}
