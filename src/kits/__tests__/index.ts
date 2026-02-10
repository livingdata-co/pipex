import test from 'ava'
import {getKit} from '../index.js'

test('getKit returns bash kit', t => {
  const kit = getKit('bash')
  t.is(kit.name, 'bash')
})

test('getKit returns node kit', t => {
  const kit = getKit('node')
  t.is(kit.name, 'node')
})

test('getKit returns python kit', t => {
  const kit = getKit('python')
  t.is(kit.name, 'python')
})

test('getKit throws on unknown kit with available list', t => {
  const error = t.throws(() => getKit('unknown'))
  t.truthy(error?.message.includes('Unknown kit'))
  t.truthy(error?.message.includes('bash'))
  t.truthy(error?.message.includes('node'))
  t.truthy(error?.message.includes('python'))
})
