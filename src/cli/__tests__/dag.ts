import test from 'ava'
import {CyclicDependencyError, ValidationError} from '../../errors.js'
import type {Step} from '../../types.js'
import {buildGraph, validateGraph, topologicalLevels, subgraph, leafNodes} from '../dag.js'

function makeStep(id: string, inputs?: Array<{step: string; optional?: boolean}>): Step {
  return {
    id,
    image: 'alpine:3.20',
    cmd: ['echo', id],
    inputs: inputs?.map(i => ({step: i.step, optional: i.optional}))
  }
}

// -- buildGraph --------------------------------------------------------------

test('buildGraph: linear pipeline', t => {
  const steps = [makeStep('a'), makeStep('b', [{step: 'a'}]), makeStep('c', [{step: 'b'}])]
  const graph = buildGraph(steps)
  t.deepEqual([...graph.get('a')!], [])
  t.deepEqual([...graph.get('b')!], ['a'])
  t.deepEqual([...graph.get('c')!], ['b'])
})

test('buildGraph: diamond', t => {
  const steps = [
    makeStep('a'),
    makeStep('b', [{step: 'a'}]),
    makeStep('c', [{step: 'a'}]),
    makeStep('d', [{step: 'b'}, {step: 'c'}])
  ]
  const graph = buildGraph(steps)
  t.is(graph.get('a')!.size, 0)
  t.deepEqual([...graph.get('d')!].sort(), ['b', 'c'])
})

test('buildGraph: step without inputs has empty deps', t => {
  const steps = [makeStep('a'), makeStep('b')]
  const graph = buildGraph(steps)
  t.is(graph.get('a')!.size, 0)
  t.is(graph.get('b')!.size, 0)
})

// -- validateGraph -----------------------------------------------------------

test('validateGraph: detects cycle', t => {
  const steps = [
    makeStep('a', [{step: 'b'}]),
    makeStep('b', [{step: 'a'}])
  ]
  const graph = buildGraph(steps)
  t.throws(() => {
    validateGraph(graph, steps)
  }, {instanceOf: CyclicDependencyError})
})

test('validateGraph: detects missing ref', t => {
  const steps = [makeStep('a', [{step: 'missing'}])]
  const graph = buildGraph(steps)
  t.throws(() => {
    validateGraph(graph, steps)
  }, {instanceOf: ValidationError, message: /unknown step 'missing'/})
})

test('validateGraph: optional ref to unknown step is OK', t => {
  const steps = [makeStep('a', [{step: 'missing', optional: true}])]
  const graph = buildGraph(steps)
  t.notThrows(() => {
    validateGraph(graph, steps)
  })
})

test('validateGraph: valid DAG passes', t => {
  const steps = [
    makeStep('a'),
    makeStep('b', [{step: 'a'}]),
    makeStep('c', [{step: 'a'}]),
    makeStep('d', [{step: 'b'}, {step: 'c'}])
  ]
  const graph = buildGraph(steps)
  t.notThrows(() => {
    validateGraph(graph, steps)
  })
})

// -- topologicalLevels -------------------------------------------------------

test('topologicalLevels: linear → one per level', t => {
  const steps = [makeStep('a'), makeStep('b', [{step: 'a'}]), makeStep('c', [{step: 'b'}])]
  const graph = buildGraph(steps)
  const levels = topologicalLevels(graph)
  t.is(levels.length, 3)
  t.deepEqual(levels[0], ['a'])
  t.deepEqual(levels[1], ['b'])
  t.deepEqual(levels[2], ['c'])
})

test('topologicalLevels: diamond → 3 levels', t => {
  const steps = [
    makeStep('a'),
    makeStep('b', [{step: 'a'}]),
    makeStep('c', [{step: 'a'}]),
    makeStep('d', [{step: 'b'}, {step: 'c'}])
  ]
  const graph = buildGraph(steps)
  const levels = topologicalLevels(graph)
  t.is(levels.length, 3)
  t.deepEqual(levels[0], ['a'])
  t.deepEqual(levels[1].sort(), ['b', 'c'])
  t.deepEqual(levels[2], ['d'])
})

test('topologicalLevels: independent steps → all level 0', t => {
  const steps = [makeStep('a'), makeStep('b'), makeStep('c')]
  const graph = buildGraph(steps)
  const levels = topologicalLevels(graph)
  t.is(levels.length, 1)
  t.deepEqual(levels[0].sort(), ['a', 'b', 'c'])
})

// -- subgraph ----------------------------------------------------------------

test('subgraph: targeting leaf includes all ancestors', t => {
  const steps = [makeStep('a'), makeStep('b', [{step: 'a'}]), makeStep('c', [{step: 'b'}])]
  const graph = buildGraph(steps)
  const result = subgraph(graph, ['c'])
  t.deepEqual([...result].sort(), ['a', 'b', 'c'])
})

test('subgraph: targeting root includes only root', t => {
  const steps = [makeStep('a'), makeStep('b', [{step: 'a'}]), makeStep('c', [{step: 'b'}])]
  const graph = buildGraph(steps)
  const result = subgraph(graph, ['a'])
  t.deepEqual([...result], ['a'])
})

test('subgraph: diamond targeting d includes all', t => {
  const steps = [
    makeStep('a'),
    makeStep('b', [{step: 'a'}]),
    makeStep('c', [{step: 'a'}]),
    makeStep('d', [{step: 'b'}, {step: 'c'}])
  ]
  const graph = buildGraph(steps)
  const result = subgraph(graph, ['d'])
  t.deepEqual([...result].sort(), ['a', 'b', 'c', 'd'])
})

// -- leafNodes ---------------------------------------------------------------

test('leafNodes: linear → last step', t => {
  const steps = [makeStep('a'), makeStep('b', [{step: 'a'}]), makeStep('c', [{step: 'b'}])]
  const graph = buildGraph(steps)
  t.deepEqual(leafNodes(graph), ['c'])
})

test('leafNodes: diamond → d', t => {
  const steps = [
    makeStep('a'),
    makeStep('b', [{step: 'a'}]),
    makeStep('c', [{step: 'a'}]),
    makeStep('d', [{step: 'b'}, {step: 'c'}])
  ]
  const graph = buildGraph(steps)
  t.deepEqual(leafNodes(graph), ['d'])
})

test('leafNodes: two independent chains → two leaves', t => {
  const steps = [
    makeStep('a'),
    makeStep('b', [{step: 'a'}]),
    makeStep('c'),
    makeStep('d', [{step: 'c'}])
  ]
  const graph = buildGraph(steps)
  t.deepEqual(leafNodes(graph).sort(), ['b', 'd'])
})
