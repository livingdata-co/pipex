import type {RunContainerRequest, RunContainerResult} from './types.js'
import type {Workspace} from './workspace.js'

/**
 * Log line from container execution.
 */
export type LogLine = {
  /** Output stream (stdout or stderr) */
  stream: 'stdout' | 'stderr';
  /** Log line content */
  line: string;
}

/**
 * Callback for receiving real-time logs during container execution.
 */
export type OnLogLine = (log: LogLine) => void

/**
 * Abstract interface for executing containers.
 *
 * Implementations:
 * - `DockerCliExecutor`: Uses Docker CLI
 * - Future: PodmanExecutor, KubernetesExecutor, etc.
 *
 * The executor is responsible for:
 * - Running containers with specified configuration
 * - Mounting input artifacts as read-only volumes
 * - Mounting output staging directory as read-write volume
 * - Streaming logs in real-time
 * - Cleaning up containers after execution
 */
export abstract class ContainerExecutor {
  /**
   * Verifies that the executor is available and functional.
   * @throws If the executor is not installed or not accessible
   */
  abstract check(): Promise<void>

  /**
   * Executes a container with the specified configuration.
   * @param workspace - Workspace for resolving artifact paths
   * @param request - Execution configuration (image, cmd, mounts, env)
   * @param onLogLine - Callback for real-time stdout/stderr logs
   * @returns Execution result with exitCode, timestamps, and optional error
   */
  abstract run(workspace: Workspace, request: RunContainerRequest, onLogLine: OnLogLine): Promise<RunContainerResult>
}
