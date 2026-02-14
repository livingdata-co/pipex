import {readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {stringify as yamlStringify} from 'yaml'
import test from 'ava'
import {DockerCliExecutor} from '../../engine/docker-executor.js'
import {PipelineLoader} from '../pipeline-loader.js'
import {PipelineRunner} from '../pipeline-runner.js'
import {Workspace} from '../../engine/workspace.js'
import {createTmpDir, isDockerAvailable, noopReporter, recordingReporter} from '../../__tests__/helpers.js'

const hasDocker = isDockerAvailable()
const dockerTest = hasDocker ? test : test.skip

// -- helpers -----------------------------------------------------------------

async function writePipeline(dir: string, config: Record<string, unknown>): Promise<string> {
  const filePath = join(dir, 'pipeline.yaml')
  await writeFile(filePath, yamlStringify(config), 'utf8')
  return filePath
}

// -- two-step dependency -----------------------------------------------------

dockerTest('step B reads step A output via inputs', async t => {
  const tmpDir = await createTmpDir()
  const workdir = await createTmpDir()

  const pipelinePath = await writePipeline(tmpDir, {
    id: 'dep-test',
    steps: [
      {id: 'a', image: 'alpine:3.20', cmd: ['sh', '-c', 'echo data > /output/result.txt']},
      {id: 'b', image: 'alpine:3.20', cmd: ['sh', '-c', 'cat /input/a/result.txt > /output/copy.txt'], inputs: [{step: 'a'}]}
    ]
  })

  const {reporter, events} = recordingReporter()
  await new PipelineRunner(new PipelineLoader(), new DockerCliExecutor(), reporter, workdir).run(pipelinePath)

  // Both steps should have finished (not just "not crashed")
  const finished = events.filter(e => e.event === 'STEP_FINISHED')
  t.is(finished.length, 2)

  // Verify step B's artifact actually contains step A's output
  const ws = await Workspace.open(workdir, 'dep-test')
  const bRunId = finished.find(e => e.step?.id === 'b')?.meta?.runId as string
  t.truthy(bRunId)
  const content = await readFile(join(ws.runArtifactsPath(bRunId), 'copy.txt'), 'utf8')
  t.is(content.trim(), 'data')
})

// -- cache hit on re-run -----------------------------------------------------

dockerTest('re-running same pipeline skips all steps (cached)', async t => {
  const tmpDir = await createTmpDir()
  const workdir = await createTmpDir()

  const pipelinePath = await writePipeline(tmpDir, {
    id: 'cache-hit',
    steps: [
      {id: 'a', image: 'alpine:3.20', cmd: ['sh', '-c', 'echo a > /output/a.txt']},
      {id: 'b', image: 'alpine:3.20', cmd: ['sh', '-c', 'echo b > /output/b.txt']}
    ]
  })

  const loader = new PipelineLoader()
  const executor = new DockerCliExecutor()

  // First run — executes
  await new PipelineRunner(loader, executor, noopReporter, workdir).run(pipelinePath)

  // Second run — should skip
  const {reporter, events} = recordingReporter()
  await new PipelineRunner(loader, executor, reporter, workdir).run(pipelinePath)

  const skipped = events.filter(e => e.event === 'STEP_SKIPPED')
  t.is(skipped.length, 2)
})

// -- cache invalidation cascade ----------------------------------------------

dockerTest('modifying step A cmd re-executes both steps', async t => {
  const tmpDir = await createTmpDir()
  const workdir = await createTmpDir()

  const loader = new PipelineLoader()
  const executor = new DockerCliExecutor()

  // First run
  const path1 = await writePipeline(tmpDir, {
    id: 'cascade',
    steps: [
      {id: 'a', image: 'alpine:3.20', cmd: ['sh', '-c', 'echo v1 > /output/a.txt']},
      {id: 'b', image: 'alpine:3.20', cmd: ['sh', '-c', 'cat /input/a/a.txt > /output/b.txt'], inputs: [{step: 'a'}]}
    ]
  })
  await new PipelineRunner(loader, executor, noopReporter, workdir).run(path1)

  // Modify step A cmd
  const path2 = await writePipeline(tmpDir, {
    id: 'cascade',
    steps: [
      {id: 'a', image: 'alpine:3.20', cmd: ['sh', '-c', 'echo v2 > /output/a.txt']},
      {id: 'b', image: 'alpine:3.20', cmd: ['sh', '-c', 'cat /input/a/a.txt > /output/b.txt'], inputs: [{step: 'a'}]}
    ]
  })

  const {reporter, events} = recordingReporter()
  await new PipelineRunner(loader, executor, reporter, workdir).run(path2)

  // Both steps should have executed (STEP_STARTING events, not STEP_SKIPPED)
  const starting = events.filter(e => e.event === 'STEP_STARTING')
  const skipped = events.filter(e => e.event === 'STEP_SKIPPED')
  t.is(starting.length, 2)
  t.is(skipped.length, 0)
})

// -- allowFailure ------------------------------------------------------------

dockerTest('step B executes even when step A fails with allowFailure', async t => {
  const tmpDir = await createTmpDir()
  const workdir = await createTmpDir()

  const pipelinePath = await writePipeline(tmpDir, {
    id: 'allow-fail',
    steps: [
      {id: 'a', image: 'alpine:3.20', cmd: ['sh', '-c', 'exit 1'], allowFailure: true},
      {id: 'b', image: 'alpine:3.20', cmd: ['sh', '-c', 'echo ok > /output/b.txt']}
    ]
  })

  const {reporter, events} = recordingReporter()
  await new PipelineRunner(new PipelineLoader(), new DockerCliExecutor(), reporter, workdir).run(pipelinePath)

  // Step B should have finished successfully
  const finished = events.filter(e => e.event === 'STEP_FINISHED')
  t.true(finished.some(e => e.step?.id === 'b'))
})

// -- force specific step -----------------------------------------------------

dockerTest('force specific step re-executes only that step', async t => {
  const tmpDir = await createTmpDir()
  const workdir = await createTmpDir()

  const pipelinePath = await writePipeline(tmpDir, {
    id: 'force-one',
    steps: [
      {id: 'a', image: 'alpine:3.20', cmd: ['sh', '-c', 'echo a > /output/a.txt']},
      {id: 'b', image: 'alpine:3.20', cmd: ['sh', '-c', 'echo b > /output/b.txt']}
    ]
  })

  const loader = new PipelineLoader()
  const executor = new DockerCliExecutor()

  // First run
  await new PipelineRunner(loader, executor, noopReporter, workdir).run(pipelinePath)

  // Second run with force on step b only
  const {reporter, events} = recordingReporter()
  await new PipelineRunner(loader, executor, reporter, workdir).run(pipelinePath, {force: ['b']})

  const skipped = events.filter(e => e.event === 'STEP_SKIPPED')
  const starting = events.filter(e => e.event === 'STEP_STARTING')
  t.is(skipped.length, 1)
  t.is(skipped[0].step?.id, 'a')
  t.is(starting.length, 1)
  t.is(starting[0].step?.id, 'b')
})

// -- dry run -----------------------------------------------------------------

dockerTest('dryRun emits STEP_WOULD_RUN without executing or committing', async t => {
  const tmpDir = await createTmpDir()
  const workdir = await createTmpDir()

  const pipelinePath = await writePipeline(tmpDir, {
    id: 'dry-run',
    steps: [
      {id: 'a', image: 'alpine:3.20', cmd: ['sh', '-c', 'echo a > /output/a.txt']}
    ]
  })

  const {reporter, events} = recordingReporter()
  await new PipelineRunner(new PipelineLoader(), new DockerCliExecutor(), reporter, workdir).run(pipelinePath, {dryRun: true})

  t.truthy(events.find(e => e.event === 'STEP_WOULD_RUN'))
  t.falsy(events.find(e => e.event === 'STEP_STARTING'))

  // No runs should have been committed to disk
  const ws = await Workspace.open(workdir, 'dry-run')
  const runs = await ws.listRuns()
  t.is(runs.length, 0)
})
