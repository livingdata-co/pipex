import {Buffer} from 'node:buffer'
import {PassThrough} from 'node:stream'
import test from 'ava'
import {NdjsonEncoder, NdjsonDecoder} from '../daemon/ndjson.js'

async function collectObjects(decoder: NdjsonDecoder): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const results: unknown[] = []
    decoder.on('data', (obj: unknown) => results.push(obj))
    decoder.on('end', () => {
      resolve(results)
    })
    decoder.on('error', reject)
  })
}

test('single object round-trip', async t => {
  const encoder = new NdjsonEncoder()
  const decoder = new NdjsonDecoder()
  encoder.pipe(decoder)

  const promise = collectObjects(decoder)
  encoder.write({hello: 'world'})
  encoder.end()

  const results = await promise
  t.deepEqual(results, [{hello: 'world'}])
})

test('multiple objects in one chunk', async t => {
  const decoder = new NdjsonDecoder()
  const promise = collectObjects(decoder)

  decoder.write(Buffer.from('{"a":1}\n{"b":2}\n{"c":3}\n'))
  decoder.end()

  const results = await promise
  t.deepEqual(results, [{a: 1}, {b: 2}, {c: 3}])
})

test('object split across chunks (partial line buffering)', async t => {
  const decoder = new NdjsonDecoder()
  const promise = collectObjects(decoder)

  decoder.write(Buffer.from('{"hel'))
  decoder.write(Buffer.from('lo":"wor'))
  decoder.write(Buffer.from('ld"}\n'))
  decoder.end()

  const results = await promise
  t.deepEqual(results, [{hello: 'world'}])
})

test('malformed JSON line is skipped (no crash)', async t => {
  const decoder = new NdjsonDecoder()
  const promise = collectObjects(decoder)

  decoder.write(Buffer.from('{"valid":true}\nnot-json\n{"also":"valid"}\n'))
  decoder.end()

  const results = await promise
  t.deepEqual(results, [{valid: true}, {also: 'valid'}])
})

test('empty lines are ignored', async t => {
  const decoder = new NdjsonDecoder()
  const promise = collectObjects(decoder)

  decoder.write(Buffer.from('\n\n{"a":1}\n\n\n{"b":2}\n\n'))
  decoder.end()

  const results = await promise
  t.deepEqual(results, [{a: 1}, {b: 2}])
})

test('encoder produces valid NDJSON', async t => {
  const encoder = new NdjsonEncoder()
  const chunks: Uint8Array[] = []

  const sink = new PassThrough()
  encoder.pipe(sink)
  sink.on('data', (chunk: Uint8Array) => chunks.push(chunk))

  encoder.write({x: 1})
  encoder.write({y: 2})
  encoder.end()

  await new Promise(resolve => {
    sink.on('end', resolve)
  })

  const output = Buffer.concat(chunks).toString()
  const lines = output.split('\n').filter(l => l.length > 0)
  t.is(lines.length, 2)
  t.deepEqual(JSON.parse(lines[0]), {x: 1})
  t.deepEqual(JSON.parse(lines[1]), {y: 2})
})

test('flush processes remaining buffer', async t => {
  const decoder = new NdjsonDecoder()
  const promise = collectObjects(decoder)

  // Write a line without trailing newline — should be flushed on end
  decoder.write(Buffer.from('{"final":true}'))
  decoder.end()

  const results = await promise
  t.deepEqual(results, [{final: true}])
})
