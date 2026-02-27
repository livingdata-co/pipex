import {CyclicDependencyError, ValidationError} from './errors.js'
import type {Step} from './types.js'

/** Maps each stepId to its set of dependency stepIds. */
export type StepGraph = Map<string, Set<string>>

/** Build a dependency graph from resolved steps. */
export function buildGraph(steps: Step[]): StepGraph {
  const graph: StepGraph = new Map()
  for (const step of steps) {
    const deps = new Set<string>()
    if (step.inputs) {
      for (const input of step.inputs) {
        deps.add(input.step)
      }
    }

    graph.set(step.id, deps)
  }

  return graph
}

/** Validate graph: check for missing refs (non-optional) and cycles. */
export function validateGraph(graph: StepGraph, steps: Step[]): void {
  validateReferences(graph, steps)
  detectCycles(graph)
}

function validateReferences(graph: StepGraph, steps: Step[]): void {
  const optionalInputs = new Set<string>()
  for (const step of steps) {
    if (step.inputs) {
      for (const input of step.inputs) {
        if (input.optional) {
          optionalInputs.add(`${step.id}:${input.step}`)
        }
      }
    }
  }

  for (const [stepId, deps] of graph) {
    for (const dep of deps) {
      if (!graph.has(dep) && !optionalInputs.has(`${stepId}:${dep}`)) {
        throw new ValidationError(`Step '${stepId}' references unknown step '${dep}'`)
      }
    }
  }
}

function detectCycles(graph: StepGraph): void {
  const inDeg = computeInDegree(graph)

  const queue: string[] = []
  for (const [id, deg] of inDeg) {
    if (deg === 0) {
      queue.push(id)
    }
  }

  let processed = 0
  while (queue.length > 0) {
    const current = queue.shift()!
    processed++

    for (const [id, deps] of graph) {
      if (deps.has(current)) {
        const newDeg = inDeg.get(id)! - 1
        inDeg.set(id, newDeg)
        if (newDeg === 0) {
          queue.push(id)
        }
      }
    }
  }

  if (processed < graph.size) {
    throw new CyclicDependencyError('Pipeline contains a dependency cycle')
  }
}

/** Compute in-degree for each node (number of existing deps). */
function computeInDegree(graph: StepGraph): Map<string, number> {
  const inDeg = new Map<string, number>()
  for (const [id, deps] of graph) {
    let count = 0
    for (const dep of deps) {
      if (graph.has(dep)) {
        count++
      }
    }

    inDeg.set(id, count)
  }

  return inDeg
}

/** Return steps grouped by topological level (parallelizable groups). */
export function topologicalLevels(graph: StepGraph): string[][] {
  const inDeg = computeInDegree(graph)
  const levels: string[][] = []
  const remaining = new Set(graph.keys())

  while (remaining.size > 0) {
    const level: string[] = []
    for (const id of remaining) {
      if (inDeg.get(id) === 0) {
        level.push(id)
      }
    }

    if (level.length === 0) {
      break // Cycle — should not happen after validateGraph
    }

    levels.push(level)

    for (const id of level) {
      remaining.delete(id)
      for (const [nodeId, deps] of graph) {
        if (deps.has(id) && remaining.has(nodeId)) {
          inDeg.set(nodeId, inDeg.get(nodeId)! - 1)
        }
      }
    }
  }

  return levels
}

/** BFS backward from targets to collect all ancestors + targets. */
export function subgraph(graph: StepGraph, targets: string[]): Set<string> {
  const result = new Set<string>()
  const queue = [...targets]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (result.has(current)) {
      continue
    }

    result.add(current)
    const deps = graph.get(current)
    if (deps) {
      for (const dep of deps) {
        if (!result.has(dep)) {
          queue.push(dep)
        }
      }
    }
  }

  return result
}

/** Return steps that no other step depends on (leaf/terminal nodes). */
export function leafNodes(graph: StepGraph): string[] {
  const depended = new Set<string>()
  for (const deps of graph.values()) {
    for (const dep of deps) {
      depended.add(dep)
    }
  }

  const leaves: string[] = []
  for (const id of graph.keys()) {
    if (!depended.has(id)) {
      leaves.push(id)
    }
  }

  return leaves
}
