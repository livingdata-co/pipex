import test from 'ava'
import {
  PipelineLoader,
  slugify,
  parsePipelineFile,
  mergeEnv,
  mergeCaches,
  mergeMounts
} from '../pipeline-loader.js'

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

test('slugify converts accented characters', t => {
  t.is(slugify('Étape numéro un'), 'etape-numero-un')
})

test('slugify replaces spaces with hyphens', t => {
  t.is(slugify('hello world'), 'hello-world')
})

test('slugify replaces special characters', t => {
  t.is(slugify('build@v2!'), 'build-v2')
  t.is(slugify('build@v2!final'), 'build-v2-final')
})

test('slugify collapses double hyphens', t => {
  t.is(slugify('a--b'), 'a-b')
})

test('slugify strips leading and trailing hyphens', t => {
  t.is(slugify('-hello-'), 'hello')
})

// ---------------------------------------------------------------------------
// parsePipelineFile
// ---------------------------------------------------------------------------

test('parsePipelineFile parses valid JSON', t => {
  const result = parsePipelineFile('{"id": "test"}', 'pipeline.json') as {id: string}
  t.is(result.id, 'test')
})

test('parsePipelineFile parses YAML for .yaml extension', t => {
  const result = parsePipelineFile('id: test', 'pipeline.yaml') as {id: string}
  t.is(result.id, 'test')
})

test('parsePipelineFile parses YAML for .yml extension', t => {
  const result = parsePipelineFile('id: test', 'pipeline.yml') as {id: string}
  t.is(result.id, 'test')
})

test('parsePipelineFile throws on invalid JSON', t => {
  t.throws(() => parsePipelineFile('{invalid', 'pipeline.json'))
})

// ---------------------------------------------------------------------------
// mergeEnv
// ---------------------------------------------------------------------------

test('mergeEnv returns undefined when both are undefined', t => {
  t.is(mergeEnv(undefined, undefined), undefined)
})

test('mergeEnv returns kit env when user is undefined', t => {
  t.deepEqual(mergeEnv({A: '1'}, undefined), {A: '1'})
})

test('mergeEnv returns user env when kit is undefined', t => {
  t.deepEqual(mergeEnv(undefined, {B: '2'}), {B: '2'})
})

test('mergeEnv user overrides kit', t => {
  t.deepEqual(mergeEnv({A: '1'}, {A: '2'}), {A: '2'})
})

test('mergeEnv merges both', t => {
  t.deepEqual(mergeEnv({A: '1'}, {B: '2'}), {A: '1', B: '2'})
})

// ---------------------------------------------------------------------------
// mergeCaches
// ---------------------------------------------------------------------------

test('mergeCaches returns undefined when both are undefined', t => {
  t.is(mergeCaches(undefined, undefined), undefined)
})

test('mergeCaches concatenates non-overlapping caches', t => {
  const result = mergeCaches(
    [{name: 'a', path: '/a'}],
    [{name: 'b', path: '/b'}]
  )
  t.deepEqual(result, [
    {name: 'a', path: '/a'},
    {name: 'b', path: '/b'}
  ])
})

test('mergeCaches user wins on same name', t => {
  const result = mergeCaches(
    [{name: 'x', path: '/kit'}],
    [{name: 'x', path: '/user'}]
  )
  t.deepEqual(result, [{name: 'x', path: '/user'}])
})

// ---------------------------------------------------------------------------
// mergeMounts
// ---------------------------------------------------------------------------

test('mergeMounts returns undefined when both are undefined', t => {
  t.is(mergeMounts(undefined, undefined), undefined)
})

test('mergeMounts concatenates mounts', t => {
  const result = mergeMounts(
    [{host: 'a', container: '/a'}],
    [{host: 'b', container: '/b'}]
  )
  t.deepEqual(result, [
    {host: 'a', container: '/a'},
    {host: 'b', container: '/b'}
  ])
})

// ---------------------------------------------------------------------------
// PipelineLoader.parse
// ---------------------------------------------------------------------------

const loader = new PipelineLoader()

test('parse: valid pipeline with raw steps', t => {
  const pipeline = loader.parse(JSON.stringify({
    id: 'my-pipeline',
    steps: [{
      id: 'step1',
      image: 'alpine',
      cmd: ['echo', 'hello']
    }]
  }), 'p.json')

  t.is(pipeline.id, 'my-pipeline')
  t.is(pipeline.steps.length, 1)
  t.is(pipeline.steps[0].id, 'step1')
})

test('parse: derives id from name via slugify', t => {
  const pipeline = loader.parse(JSON.stringify({
    name: 'Mon Pipeline',
    steps: [{
      name: 'Première Étape',
      image: 'alpine',
      cmd: ['echo']
    }]
  }), 'p.json')

  t.is(pipeline.id, 'mon-pipeline')
  t.is(pipeline.steps[0].id, 'premiere-etape')
})

test('parse: throws when neither id nor name on pipeline', t => {
  t.throws(() => loader.parse(JSON.stringify({
    steps: [{id: 's', image: 'alpine', cmd: ['echo']}]
  }), 'p.json'), {message: /at least one of "id" or "name"/})
})

test('parse: throws when neither id nor name on step', t => {
  t.throws(() => loader.parse(JSON.stringify({
    id: 'p',
    steps: [{image: 'alpine', cmd: ['echo']}]
  }), 'p.json'), {message: /at least one of "id" or "name"/})
})

test('parse: throws on empty steps array', t => {
  t.throws(() => loader.parse(JSON.stringify({
    id: 'p', steps: []
  }), 'p.json'), {message: /steps must be a non-empty array/})
})

test('parse: throws on invalid identifier with path traversal', t => {
  t.throws(() => loader.parse(JSON.stringify({
    id: 'p',
    steps: [{id: '../bad', image: 'alpine', cmd: ['echo']}]
  }), 'p.json'), {message: /must contain only alphanumeric/})
})

test('parse: throws on invalid identifier with special chars', t => {
  t.throws(() => loader.parse(JSON.stringify({
    id: 'p',
    steps: [{id: 'hello world', image: 'alpine', cmd: ['echo']}]
  }), 'p.json'), {message: /must contain only alphanumeric/})
})

test('parse: throws when step has no image', t => {
  t.throws(() => loader.parse(JSON.stringify({
    id: 'p',
    steps: [{id: 's', cmd: ['echo']}]
  }), 'p.json'), {message: /image is required/})
})

test('parse: throws when step has no cmd', t => {
  t.throws(() => loader.parse(JSON.stringify({
    id: 'p',
    steps: [{id: 's', image: 'alpine'}]
  }), 'p.json'), {message: /cmd must be a non-empty array/})
})

test('parse: throws on duplicate step ids', t => {
  t.throws(() => loader.parse(JSON.stringify({
    id: 'p',
    steps: [
      {id: 's', image: 'alpine', cmd: ['echo']},
      {id: 's', image: 'alpine', cmd: ['echo']}
    ]
  }), 'p.json'), {message: /Duplicate step id/})
})

test('parse: validates mount host must be relative', t => {
  t.throws(() => loader.parse(JSON.stringify({
    id: 'p',
    steps: [{
      id: 's', image: 'alpine', cmd: ['echo'],
      mounts: [{host: '/absolute', container: '/c'}]
    }]
  }), 'p.json'), {message: /must be a relative path/})
})

test('parse: validates mount host no ..', t => {
  t.throws(() => loader.parse(JSON.stringify({
    id: 'p',
    steps: [{
      id: 's', image: 'alpine', cmd: ['echo'],
      mounts: [{host: '../escape', container: '/c'}]
    }]
  }), 'p.json'), {message: /must not contain '\.\.'/})
})

test('parse: validates mount container must be absolute', t => {
  t.throws(() => loader.parse(JSON.stringify({
    id: 'p',
    steps: [{
      id: 's', image: 'alpine', cmd: ['echo'],
      mounts: [{host: 'src', container: 'relative'}]
    }]
  }), 'p.json'), {message: /must be an absolute path/})
})

test('parse: validates cache path must be absolute', t => {
  t.throws(() => loader.parse(JSON.stringify({
    id: 'p',
    steps: [{
      id: 's', image: 'alpine', cmd: ['echo'],
      caches: [{name: 'c', path: 'relative'}]
    }]
  }), 'p.json'), {message: /must be an absolute path/})
})

test('parse: validates cache name is a valid identifier', t => {
  t.throws(() => loader.parse(JSON.stringify({
    id: 'p',
    steps: [{
      id: 's', image: 'alpine', cmd: ['echo'],
      caches: [{name: 'bad name!', path: '/cache'}]
    }]
  }), 'p.json'), {message: /must contain only alphanumeric/})
})

test('parse: resolves kit step (uses → image/cmd)', t => {
  const pipeline = loader.parse(JSON.stringify({
    id: 'p',
    steps: [{
      id: 'b',
      uses: 'bash',
      with: {run: 'echo hello'}
    }]
  }), 'p.json')

  t.is(pipeline.steps[0].image, 'alpine:3.20')
  t.deepEqual(pipeline.steps[0].cmd, ['sh', '-c', 'echo hello'])
})
