import { createHash, randomBytes } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { evaluateRadar, parseRadarInput, type RadarInput, type RadarEvaluation } from '../src/radar/engine.ts'

export interface Run {
  id: number; savedAt: string; previousHash: string | null; hash: string
  inputHash: string; researchHash: string; input: RadarInput; evaluation: RadarEvaluation
  context: { recentStrikeCount: number | null }
}
export interface Signal {
  id: string; runId: number; recordedAt: string; symbol: string; evidenceEpisode: string
  cohort: 'qualified' | 'research'; decision: string; modelVersion: string; researchRevision: string
  paperOnly: true
  observation: { status: 'PENDING'; entryRule: string; checkpointsTsxSessions: number[]; benchmark: 'XEQT.TO'; currency: 'CAD' }
}
export interface State { schemaVersion: 4; runs: Run[]; signals: Signal[]; digest: string }

function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
  if (v !== null && typeof v === 'object') return '{' + Object.entries(v).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, x]) => JSON.stringify(k) + ':' + canonical(x)).join(',') + '}'
  return JSON.stringify(v)
}
const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex')
const researchHash = (i: RadarInput) => hash({ instrument: i.instrument, thesis: i.thesis, valuation: i.valuation,
  zones: i.zones, benchmark: i.benchmark, redTeam: i.redTeam, policy: i.policy })
const signalId = (i: RadarInput, e: RadarEvaluation) => hash({ symbol: i.instrument.symbol, episode: i.evidenceEpisode,
  opportunity: e.opportunity, label: e.label })
const parseFile = (path: string, maxBytes: number) => {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error(`Expected a regular file within the size limit: ${path}`)
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

export function validateState(v: unknown): State {
  if (!v || typeof v !== 'object') throw new Error('State is not an object; refusing to replace it.')
  const s = v as State
  if (s.schemaVersion !== 4 || !Array.isArray(s.runs) || !Array.isArray(s.signals) || s.runs.length > 10000 || s.signals.length > 10000 ||
    Object.keys(s).sort().join(',') !== 'digest,runs,schemaVersion,signals') throw new Error('Unsupported or malformed state; refusing to replace it.')
  if (s.digest !== hash({ schemaVersion: 4, runs: s.runs, signals: s.signals })) throw new Error('State integrity check failed; restore the original file before running again.')
  let prior: string | null = null
  for (let n = 0; n < s.runs.length; n++) {
    const run = s.runs[n]
    const { hash: savedHash, ...body } = run
    const parsed = parseRadarInput(run.input)
    if (run.id !== n + 1 || run.previousHash !== prior || savedHash !== hash(body) || !parsed.ok ||
      run.inputHash !== hash(run.input) || run.researchHash !== researchHash(run.input) ||
      !run.context || (run.context.recentStrikeCount !== null && (!Number.isInteger(run.context.recentStrikeCount) || run.context.recentStrikeCount < 0)) ||
      run.savedAt !== run.evaluation.evaluatedAt || !Number.isFinite(Date.parse(run.savedAt)) ||
      canonical(run.evaluation) !== canonical(evaluateRadar(run.input, run.savedAt, run.context))) throw new Error('A saved run failed independent validation; no state was changed.')
    prior = savedHash
  }
  const ids = new Set<string>()
  for (const signal of s.signals) {
    const run = s.runs[signal.runId - 1]
    if (!run || ids.has(signal.id) || signal.id !== signalId(run.input, run.evaluation) ||
      signal.symbol !== run.input.instrument.symbol || signal.evidenceEpisode !== run.input.evidenceEpisode ||
      signal.recordedAt !== run.savedAt || signal.paperOnly !== true ||
      signal.modelVersion !== run.input.valuation.modelVersion || signal.researchRevision !== run.input.researchRevision ||
      signal.cohort !== (run.evaluation.label === 'NO ACTION' ? 'research' : 'qualified') ||
      signal.decision !== (run.evaluation.label === 'NO ACTION' ? run.evaluation.opportunity : run.evaluation.label) ||
      !['WATCH', 'PASS', 'BUY', 'STRIKE'].includes(signal.decision) ||
      signal.observation?.status !== 'PENDING' || signal.observation.benchmark !== 'XEQT.TO' || signal.observation.currency !== 'CAD' ||
      canonical(signal.observation.checkpointsTsxSessions) !== '[63,126]') throw new Error('A prospective signal failed validation; no state was changed.')
    ids.add(signal.id)
  }
  return s
}

export interface RadarRunSummary {
  mode: 'local'; runId: number; decision: RadarEvaluation['label']; opportunity: RadarEvaluation['opportunity']
  allocation: RadarEvaluation['allocation']; symbol: string; persisted: true; readbackVerified: true
  signalCreated: boolean; duplicateSuppressed: boolean; signalCount: number; modelRevisions: number
  blockedGates: { id: string; status: string }[]
  notificationDelivery: 'NOT OBSERVED'; performance: 'PENDING'; state: string
}

/** Missing journals are not errors; existing malformed journals always fail closed. */
export function readJournal(path: string): State | null {
  const statePath = resolve(path)
  // lstat keeps a broken symlink from being mistaken for an absent journal.
  try { lstatSync(statePath) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  return validateState(parseFile(statePath, 20 * 1024 * 1024))
}

/** Append one actual-time run. No caller-supplied clock or backdated alerts. */
export function saveRadarRun(input: unknown, journalPath: string, createState = false, options: { recordSignals?: boolean } = {}): RadarRunSummary {
  const statePath = resolve(journalPath)
  const parsed = parseRadarInput(input)
  if (!parsed.ok) throw new Error('Invalid dossier: ' + parsed.errors.join('; '))
  if (!existsSync(dirname(statePath))) throw new Error('Create the journal directory before running; no state was written.')
  const lockPath = statePath + '.lock'
  let lock: number
  try { lock = openSync(lockPath, 'wx', 0o600) } catch { throw new Error('Journal is locked by another run (or its directory is not writable). No state was changed. Inspect a leftover lock only after confirming no runner is active.') }
  let temp: string | null = null
  try {
    writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
    const exists = existsSync(statePath)
    if (createState && exists) throw new Error('State already exists; --create-state never overwrites a journal.')
    if (!createState && !exists) throw new Error('State is missing. Use --create-state only for an intentionally new journal.')
    const s: State = exists ? validateState(parseFile(statePath, 20 * 1024 * 1024)) : { schemaVersion: 4, runs: [], signals: [], digest: '' }
    if (s.runs.length >= 10000 || s.signals.length >= 10000) throw new Error('Journal capacity reached. Preserve this file and review storage before continuing; no records were truncated.')
    const i = parsed.input, rh = researchHash(i)
    const revisions = s.runs.filter(run => run.input.instrument.symbol === i.instrument.symbol && run.input.researchRevision === i.researchRevision)
    if (revisions.some(run => run.researchHash !== rh)) throw new Error('Research changed under an existing researchRevision. Assign a new revision; original records are immutable.')
    const now = new Date().toISOString()
    if (s.runs.some(run => Date.parse(run.savedAt) > Date.parse(now))) throw new Error('Journal contains a future run; check the system clock before proceeding.')
    const windowDays = i.policy.strikeWindowDays
    const context = { recentStrikeCount: typeof windowDays === 'number' && windowDays > 0 ? s.signals.filter(signal => signal.cohort === 'qualified' && signal.decision === 'STRIKE' &&
      Date.parse(now) - Date.parse(signal.recordedAt) <= windowDays * 86400000 &&
      !(signal.symbol === i.instrument.symbol && signal.evidenceEpisode === i.evidenceEpisode)).length : null }
    const evaluation = evaluateRadar(i, now, context)
    const body = { id: s.runs.length + 1, savedAt: now, previousHash: s.runs[s.runs.length - 1]?.hash ?? null,
      inputHash: hash(i), researchHash: rh, input: i, evaluation, context }
    const run: Run = { ...body, hash: hash(body) }
    const id = signalId(i, evaluation)
    const qualifies = evaluation.label !== 'NO ACTION' || ['WATCH', 'PASS'].includes(evaluation.opportunity)
    const duplicate = s.signals.some(signal => signal.id === id)
    // App-level ELITE runs retain v4 evidence without emitting a v4 decision as a v5 signal.
    const signalCreated = options.recordSignals !== false && qualifies && !duplicate
    const signals: Signal[] = signalCreated ? [...s.signals, {
      id, runId: run.id, recordedAt: now, symbol: i.instrument.symbol, evidenceEpisode: i.evidenceEpisode,
      cohort: evaluation.label === 'NO ACTION' ? 'research' : 'qualified',
      decision: evaluation.label === 'NO ACTION' ? evaluation.opportunity : evaluation.label,
      modelVersion: i.valuation.modelVersion, researchRevision: i.researchRevision, paperOnly: true,
      observation: { status: 'PENDING', entryRule: 'Next actual TSX session close after this signal, with verified exact-instrument and XEQT CAD total-return observations; no simulated fill.',
        checkpointsTsxSessions: [63, 126], benchmark: 'XEQT.TO', currency: 'CAD' },
    }] : s.signals
    const data = { schemaVersion: 4 as const, runs: [...s.runs, run], signals }
    const next = { ...data, digest: hash(data) }
    validateState(next)
    const encoded = JSON.stringify(next, null, 2) + '\n'
    if (Buffer.byteLength(encoded) > 20 * 1024 * 1024) throw new Error('Journal size limit reached; no records were truncated.')
    temp = statePath + `.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    const fd = openSync(temp, 'wx', 0o600)
    try { writeFileSync(fd, encoded); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(temp, statePath); temp = null
    const readback = readFileSync(statePath, 'utf8')
    if (readback !== encoded) throw new Error('Write occurred but independent readback did not match; inspect the journal before retrying.')
    const verified = validateState(JSON.parse(readback))
    return { mode: 'local', runId: run.id, decision: evaluation.label, opportunity: evaluation.opportunity,
      allocation: evaluation.allocation, symbol: i.instrument.symbol, persisted: true, readbackVerified: true,
      signalCreated, duplicateSuppressed: options.recordSignals !== false && qualifies && duplicate, signalCount: verified.signals.length,
      modelRevisions: new Set(verified.runs.map(x => x.input.instrument.symbol + ':' + x.input.researchRevision)).size,
      blockedGates: evaluation.gates.filter(g => g.status !== 'pass').map(g => ({ id: g.id, status: g.status })),
      notificationDelivery: 'NOT OBSERVED', performance: 'PENDING', state: statePath }
  } finally {
    if (temp && existsSync(temp)) unlinkSync(temp)
    closeSync(lock)
    unlinkSync(lockPath)
  }
}
