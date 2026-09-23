import { lstatSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { emptyRadarInput } from '../src/radar/engine.ts'
import { saveRadarRun } from '../server/radar-journal.ts'

const parseFile = (path: string, maxBytes: number) => {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error(`Expected a regular file within the size limit: ${path}`)
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || !args.length) {
    console.log('Strike Radar v4 — local research runner, no trading or scheduler\n\n' +
      'npm run radar -- --init MSFT.NE --underlying MSFT\n' +
      'npm run radar -- --input .radar/dossier.json --state .radar/journal.json --create-state\n' +
      'npm run radar -- --input .radar/dossier.json --state .radar/journal.json\n\n' +
      'Use npm run --silent radar to redirect a starter dossier to a file. Create its directory first.\n' +
      'State creation must be explicit. Existing state is validated and never reset on error.\n' +
      'Research IDs are immutable; change researchRevision when changing model/evidence/policy.\n' +
      'Refresh quote/execution/portfolio observations under the same research revision.\n' +
      'Change evidenceEpisode only for a meaningful new signal episode. All outcomes remain pending.\n' +
      'No backdated --now option is supported. A local run is not proof of ChatGPT scheduler execution.')
    return
  }
  const options = new Map<string, string | true>()
  for (let n = 0; n < args.length; n++) {
    const a = args[n]
    if (!['--init', '--underlying', '--input', '--state', '--create-state'].includes(a) || options.has(a)) throw new Error(`Unknown or repeated option: ${a}`)
    if (a === '--create-state') options.set(a, true)
    else {
      const value = args[++n]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${a}`)
      options.set(a, value)
    }
  }
  if (options.has('--init')) {
    if (options.has('--input') || options.has('--state') || options.has('--create-state')) throw new Error('--init only accepts --underlying.')
    console.log(JSON.stringify(emptyRadarInput(String(options.get('--init')), String(options.get('--underlying') ?? options.get('--init'))), null, 2))
    return
  }
  if (!options.has('--input') || !options.has('--state') || options.has('--underlying')) throw new Error('Provide --input and --state; see --help.')
  const inputPath = resolve(String(options.get('--input'))), statePath = resolve(String(options.get('--state')))
  if (inputPath === statePath) throw new Error('The dossier and journal must be different files.')
  console.log(JSON.stringify(saveRadarRun(parseFile(inputPath, 1024 * 1024), statePath, options.has('--create-state')), null, 2))
}
try { main() } catch (e) { console.error(JSON.stringify({ error: e instanceof Error ? e.message : String(e), persisted: 'UNCONFIRMED' })); process.exitCode = 1 }
