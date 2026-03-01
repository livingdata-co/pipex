/**
 * Entry point for the forked daemon process.
 *
 * Receives configuration via IPC message from parent, starts DaemonServer,
 * then sends back { type: 'ready', socketPath } when listening.
 * After handshake, the daemon runs independently until auto-shutdown.
 */
import process from 'node:process'
import type {PipexOptions} from '../pipex.js'
import type {PipexConfig} from '../types.js'
import {DaemonServer} from './daemon-server.js'

export type DaemonEntryMessage = {
  workspaceRoot: string;
  pipexOptions: PipexOptions;
  config?: PipexConfig;
  cwd?: string;
}

type ReadyMessage = {
  type: 'ready';
  socketPath: string;
}

type ErrorMessage = {
  type: 'error';
  message: string;
}

await new Promise<void>((resolve, reject) => {
  process.once('message', async (message: DaemonEntryMessage) => {
    try {
      const server = new DaemonServer({
        workspaceRoot: message.workspaceRoot,
        pipexOptions: message.pipexOptions,
        config: message.config,
        cwd: message.cwd
      })

      await server.start()

      const ready: ReadyMessage = {type: 'ready', socketPath: server.socketPath}
      process.send!(ready)

      // Disconnect IPC so parent can exit
      process.disconnect()

      resolve()
    } catch (error) {
      const errorMsg: ErrorMessage = {
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      }

      try {
        process.send!(errorMsg)
      } catch {
        // Parent already gone
      }

      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
})
