export type MountSpec = {
  host: string;
  container: string;
}

export type InputSpec = {
  step: string;
  copyToOutput?: boolean;
}

/**
 * Cache mount specification in pipeline configuration.
 */
export type CacheSpec = {
  /** Cache name (workspace-scoped, e.g., "pnpm-store") */
  name: string;
  /** Mount path in container (e.g., "/root/.local/share/pnpm/store") */
  path: string;
}

export type StepConfig = {
  id: string;
  image: string;
  cmd: string[];
  env?: Record<string, string>;
  inputs?: InputSpec[];
  outputPath?: string;
  caches?: CacheSpec[];
  mounts?: MountSpec[];
  timeoutSec?: number;
  allowFailure?: boolean;
  allowNetwork?: boolean;
}

export type PipelineConfig = {
  name?: string;
  steps: StepConfig[];
}
