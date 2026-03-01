import {Transform, type TransformCallback} from 'node:stream'

/**
 * Transforms objects into newline-delimited JSON buffers.
 * Input: object mode. Output: byte mode.
 */
export class NdjsonEncoder extends Transform {
  constructor() {
    super({writableObjectMode: true, readableObjectMode: false})
  }

  override _transform(chunk: unknown, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      const line = JSON.stringify(chunk) + '\n'
      callback(null, line)
    } catch (error) {
      callback(error as Error)
    }
  }
}

/**
 * Transforms newline-delimited JSON buffers into parsed objects.
 * Input: byte mode. Output: object mode.
 * Handles partial lines across chunks and skips malformed JSON.
 */
export class NdjsonDecoder extends Transform {
  private buffer = ''

  constructor() {
    super({writableObjectMode: false, readableObjectMode: true})
  }

  override _transform(chunk: Uint8Array, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.buffer += chunk.toString()

    const lines = this.buffer.split('\n')
    // Keep the last partial line in the buffer
    this.buffer = lines.pop()!

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length === 0) {
        continue
      }

      try {
        const parsed: unknown = JSON.parse(trimmed)
        this.push(parsed)
      } catch {
        // Skip malformed JSON lines
      }
    }

    callback()
  }

  override _flush(callback: TransformCallback): void {
    const trimmed = this.buffer.trim()
    if (trimmed.length > 0) {
      try {
        const parsed: unknown = JSON.parse(trimmed)
        this.push(parsed)
      } catch {
        // Skip malformed final line
      }
    }

    this.buffer = ''
    callback()
  }
}
