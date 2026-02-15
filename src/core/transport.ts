import type {PipelineEvent} from './reporter.js'

export type TransportMessage = {
  seq: number;
  timestamp: string;
  version: 1;
  type: string;
  event: PipelineEvent;
}

export type EventTransport = {
  publish(message: TransportMessage): Promise<void>;
  flush?(): Promise<void>;
}

export class InMemoryTransport implements EventTransport {
  readonly messages: TransportMessage[] = []

  async publish(message: TransportMessage): Promise<void> {
    this.messages.push(message)
  }

  clear(): void {
    this.messages.length = 0
  }
}
