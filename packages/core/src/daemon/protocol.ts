import type {PipelineEvent} from '../reporter.js'
import type {SerializedSessionState} from '../event-aggregator.js'
import type {Pipeline} from '../types.js'

// -- Client → Daemon commands ------------------------------------------------

export type RunCommand = {
  type: 'run';
  pipeline: Pipeline;
  options?: {
    workspace?: string;
    force?: true | string[];
    target?: string[];
    concurrency?: number;
    envFile?: string;
  };
}

export type StatusCommand = {
  type: 'status';
}

export type SubscribeCommand = {
  type: 'subscribe';
  logs?: boolean;
}

export type CancelCommand = {
  type: 'cancel';
}

export type DaemonCommand =
  | RunCommand
  | StatusCommand
  | SubscribeCommand
  | CancelCommand

// -- Daemon → Client messages ------------------------------------------------

export type EventMessage = {
  type: 'event';
  event: PipelineEvent;
}

export type StateMessage = {
  type: 'state';
  session: SerializedSessionState;
}

export type AckMessage = {
  type: 'ack';
  jobId: string;
}

export type ErrorMessage = {
  type: 'error';
  code: string;
  message: string;
}

export type DoneMessage = {
  type: 'done';
  success: boolean;
}

export type DaemonMessage =
  | EventMessage
  | StateMessage
  | AckMessage
  | ErrorMessage
  | DoneMessage
