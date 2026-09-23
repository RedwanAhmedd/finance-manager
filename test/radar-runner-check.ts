import assert from 'node:assert/strict'
import { spawnSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseRadarInput } from '../src/radar/engine.ts'
import { radarFixture } from './radar-fixture.ts'
import { readJournal } from '../server/radar-journal.ts'

const root = process.cwd(), bin = resolve(root, 'scripts/radar-v4.ts')
const cache = resolve(root, 'node_modules/.cache')
mkdirSync(cache, { recursive: true })
const dir = mkdtempSync(resolve(cache, 'radar-test-'))
const input = resolve(dir, 'fictional-dossier.json'), state = resolve(dir, 'fictional-journal.json')
let checks = 0
const check = (name: string, fn: () => void) => { fn(); checks++; console.log('ok  runner: ' + name) }
const run = (...extra: string[]) => spawnSync(process.execPath, [bin, '--input', input, '--state', state, ...extra], { encoding: 'utf8' })
const read = () => JSON.parse(readFileSync(state, 'utf8'))
const fixture = radarFixture(new Date().toISOString())
try {
  writeFileSync(input, JSON.stringify(fixture))
  check('help describes local evidence limits', () => {
    const result = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' })
    assert.equal(result.status, 0); assert.match(result.stdout, /not proof of ChatGPT scheduler/)
  })
  check('starter is valid but unverified', () => {
    const result = spawnSync(process.execPath, [bin, '--init', 'TEST.NE', '--underlying', 'TEST'], { encoding: 'utf8' })
    const parsed = parseRadarInput(JSON.parse(result.stdout))
    assert.equal(result.status, 0); assert.equal(parsed.ok, true)
    if (parsed.ok) assert.equal(parsed.input.instrument.identityVerified, null)
  })
  check('missing state never silently resets history', () => { assert.notEqual(run().status, 0); assert.equal(existsSync(state), false); assert.equal(readJournal(state), null) })
  check('first actual process writes and independently reads the dossier', () => {
    const result = run('--create-state'); assert.equal(result.status, 0, result.stderr)
    const out = JSON.parse(result.stdout)
    assert.equal(out.readbackVerified, true); assert.equal(out.runId, 1); assert.equal(out.signalCreated, true)
    assert.equal(out.decision, 'STRIKE'); assert.equal(out.mode, 'local'); assert.equal(out.notificationDelivery, 'NOT OBSERVED')
    assert.deepEqual(read().runs[0].input, fixture)
    assert.deepEqual(readJournal(state), read())
    assert.equal(read().signals[0].cohort, 'qualified'); assert.equal(read().signals[0].paperOnly, true)
    assert.deepEqual(read().signals[0].observation.checkpointsTsxSessions, [63, 126])
    assert.equal(read().signals[0].observation.status, 'PENDING')
  })
  const first = read().runs[0]
  check('second independent process retains run one and deduplicates', () => {
    const result = run(); assert.equal(result.status, 0, result.stderr)
    const out = JSON.parse(result.stdout)
    assert.equal(out.runId, 2); assert.equal(out.signalCreated, false); assert.equal(out.duplicateSuppressed, true)
    assert.equal(out.signalCount, 1); assert.deepEqual(read().runs[0], first); assert.equal(read().runs[1].previousHash, first.hash)
  })
  check('explicit creation cannot overwrite existing state', () => {
    const before = readFileSync(state, 'utf8'); assert.notEqual(run('--create-state').status, 0); assert.equal(readFileSync(state, 'utf8'), before)
  })
  check('refresh observations without inventing a new signal', () => {
    fixture.quote.price = 19.995; writeFileSync(input, JSON.stringify(fixture))
    const result = run(); assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).duplicateSuppressed, true); assert.equal(read().signals.length, 1)
  })
  check('same revision cannot mutate research', () => {
    const before = readFileSync(state, 'utf8')
    fixture.valuation.normalizationNote += ' Additional fictional model evidence.'; writeFileSync(input, JSON.stringify(fixture))
    const result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /new revision/)
    assert.equal(readFileSync(state, 'utf8'), before); assert.equal(existsSync(state + '.lock'), false)
  })
  check('new revision appends and keeps original model; same episode stays quiet', () => {
    fixture.researchRevision = 'fictional-v2'; writeFileSync(input, JSON.stringify(fixture))
    const result = run(); assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).modelRevisions, 2); assert.equal(read().signals.length, 1); assert.deepEqual(read().runs[0], first)
  })
  check('new material episode can create a new prospective record', () => {
    fixture.evidenceEpisode = 'fictional-event-2'; writeFileSync(input, JSON.stringify(fixture))
    const result = run(); assert.equal(result.status, 0, result.stderr); assert.equal(read().signals.length, 2)
  })
  check('corrupt state fails closed without replacing it', () => {
    const saved = readFileSync(state, 'utf8'), changed = read()
    changed.runs[0].input.valuation.baseFairValue = 999
    const corrupt = JSON.stringify(changed); writeFileSync(state, corrupt)
    const result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /integrity/)
    assert.equal(readFileSync(state, 'utf8'), corrupt); assert.throws(() => readJournal(state), /integrity/); writeFileSync(state, saved)
  })
  check('malformed input cannot alter state', () => {
    const saved = readFileSync(state, 'utf8'); writeFileSync(input, '{bad JSON')
    assert.notEqual(run().status, 0); assert.equal(readFileSync(state, 'utf8'), saved)
    writeFileSync(input, JSON.stringify(fixture))
  })
  check('an active lock excludes a concurrent writer', () => {
    const before = readFileSync(state, 'utf8'), fd = openSync(state + '.lock', 'wx')
    try { const result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /locked/); assert.equal(readFileSync(state, 'utf8'), before) }
    finally { closeSync(fd); unlinkSync(state + '.lock') }
  })
  check('state symlink cannot redirect writes', () => {
    const link = resolve(dir, 'linked-state.json'); symlinkSync(state, link)
    const before = readFileSync(state, 'utf8')
    const result = spawnSync(process.execPath, [bin, '--input', input, '--state', link], { encoding: 'utf8' })
    assert.notEqual(result.status, 0); assert.equal(readFileSync(state, 'utf8'), before)
    assert.throws(() => readJournal(link), /regular file/)
  })
  check('simulation timestamp flag cannot backdate prospective signals', () => { assert.notEqual(run('--now', '2020-01-01T00:00:00Z').status, 0) })
  const beforeConcurrent = read().runs.length
  const launch = () => new Promise<{ code: number | null; stderr: string }>(done => {
    const child = spawn(process.execPath, [bin, '--input', input, '--state', state], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''; child.stderr.on('data', b => { stderr += b.toString() }); child.on('close', code => done({ code, stderr }))
  })
  const concurrent = await Promise.all([launch(), launch()])
  check('two real concurrent processes never lose a successful run', () => {
    const successes = concurrent.filter(r => r.code === 0).length
    assert.ok(successes >= 1); assert.equal(read().runs.length, beforeConcurrent + successes)
    for (const r of concurrent.filter(r => r.code !== 0)) assert.match(r.stderr, /locked/)
    assert.equal(read().signals.length, 2); assert.deepEqual(read().runs[0], first)
  })
  check('atomic writes leave no lock or temporary files', () => { assert.equal(existsSync(state + '.lock'), false); assert.equal(readdirSync(dir).some(n => n.endsWith('.tmp')), false) })
  console.log(`\n${checks} local runner checks passed. These are local process tests, not scheduler or device-delivery proof.`)
} finally { rmSync(dir, { recursive: true, force: true }) }
