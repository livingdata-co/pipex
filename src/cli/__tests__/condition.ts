import test from 'ava'
import {evaluateCondition} from '../condition.js'

test('env.CI truthy when CI is defined', async t => {
  const result = await evaluateCondition('env.CI', {env: {CI: 'true'}})
  t.true(result)
})

test('env.CI falsy when CI is absent', async t => {
  const result = await evaluateCondition('env.CI', {env: {}})
  t.false(result)
})

test('env.NODE_ENV == "production" — equality', async t => {
  t.true(await evaluateCondition('env.NODE_ENV == "production"', {env: {NODE_ENV: 'production'}}))
  t.false(await evaluateCondition('env.NODE_ENV == "production"', {env: {NODE_ENV: 'development'}}))
})

test('env.CI && !env.STAGING — combined logic', async t => {
  t.true(await evaluateCondition('env.CI && !env.STAGING', {env: {CI: 'true'}}))
  t.false(await evaluateCondition('env.CI && !env.STAGING', {env: {CI: 'true', STAGING: 'true'}}))
  t.false(await evaluateCondition('env.CI && !env.STAGING', {env: {}}))
})

test('invalid expression returns false (fail-closed)', async t => {
  const result = await evaluateCondition(')))invalid(((', {env: {}})
  t.false(result)
})
