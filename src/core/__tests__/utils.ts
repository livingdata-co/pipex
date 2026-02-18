import process from 'node:process'
import {join} from 'node:path'
import test from 'ava'
import {ValidationError} from '../../errors.js'
import {resolveHostPath} from '../utils.js'

test('resolveHostPath: resolves path within cwd', t => {
  const cwd = process.cwd()
  const pipelineRoot = join(cwd, 'pipelines')
  const result = resolveHostPath(pipelineRoot, '../scripts')
  t.is(result, join(cwd, 'scripts'))
})

test('resolveHostPath: resolves sibling directory with ..', t => {
  const cwd = process.cwd()
  const pipelineRoot = join(cwd, 'a', 'b')
  const result = resolveHostPath(pipelineRoot, '../c')
  t.is(result, join(cwd, 'a', 'c'))
})

test('resolveHostPath: allows path equal to cwd', t => {
  const cwd = process.cwd()
  const pipelineRoot = join(cwd, 'sub')
  const result = resolveHostPath(pipelineRoot, '..')
  t.is(result, cwd)
})

test('resolveHostPath: simple relative path without ..', t => {
  const cwd = process.cwd()
  const pipelineRoot = join(cwd, 'pipelines')
  const result = resolveHostPath(pipelineRoot, 'data')
  t.is(result, join(cwd, 'pipelines', 'data'))
})

test('resolveHostPath: throws when path escapes cwd', t => {
  const cwd = process.cwd()
  const error = t.throws(() => resolveHostPath(cwd, '../outside'), {instanceOf: ValidationError})
  t.truthy(error?.message.includes('outside the working directory'))
})

test('resolveHostPath: throws when deeply escaping cwd', t => {
  const cwd = process.cwd()
  const pipelineRoot = join(cwd, 'a')
  const error = t.throws(() => resolveHostPath(pipelineRoot, '../../outside'), {instanceOf: ValidationError})
  t.truthy(error?.message.includes('outside the working directory'))
})
