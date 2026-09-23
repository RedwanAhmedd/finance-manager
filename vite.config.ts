import { resolve } from 'node:path'
import type { StockSnapshot } from './src/live/models'
import { createRadarHandler, createRadarService } from './server/radar.ts'
import { createRadarAlerts, ntfySender, scheduleRadarAlerts } from './server/radar-alerts.ts'
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { createAssistantHandler } from './server/assistant.ts'
import { providerFromEnv } from './server/providers.ts'
import { createSourcesHandler, sourcesFromEnv } from './server/sources.ts'
import { createFxHandler, createFxSource } from './server/fx.ts'
import { createMoneyHandler, moneyStoreFromEnv } from './server/money.ts'

// Serves /api/money, /api/fx, /api/sources and /api/assistant from the local dev/preview server.
// Secret keys and assistant settings have no VITE_ prefix, so Vite never
// places them in the browser bundle.
function localServer(env: Record<string, string>): Plugin {
  const sources = sourcesFromEnv(env)
  const getStock = async () => (await sources.stockstream?.getSnapshot() as StockSnapshot | undefined) ?? null
  const radarDirectory = resolve(env.RADAR_DIRECTORY || '.radar')
  const alerts = createRadarAlerts({ directory: radarDirectory, getStock, send: env.NTFY_TOPIC ? ntfySender({ server: env.NTFY_SERVER || undefined, topic: env.NTFY_TOPIC.trim(), token: env.NTFY_TOKEN || undefined }) : null })
  const radar = createRadarService(radarDirectory, getStock, alerts)
  const radarHandler = createRadarHandler(radar)
  const assistantHandler = createAssistantHandler(providerFromEnv(env), { saveContextTo: env.ASSISTANT_SAVE_CONTEXT || undefined, radarSnapshot: radar.snapshot })
  const sourcesHandler = createSourcesHandler(sources)
  const fxHandler = createFxHandler(createFxSource())
  const moneyHandler = createMoneyHandler(moneyStoreFromEnv(env))
  const handlers = [radarHandler, moneyHandler, fxHandler, sourcesHandler, assistantHandler]
  const install = (server: { middlewares: Connect.Server }) => { for (const handler of handlers) server.middlewares.use((req, res, next) => void handler(req, res, next)) }
  // Phone alerts run only in the always-on service (vite preview), never in the
  // dev server or under tests, so one process owns delivery.
  const startAlerts = () => { if (env.NTFY_TOPIC && !process.env.VITEST) scheduleRadarAlerts(alerts, line => console.log(`${new Date().toISOString()} ${line}`)) }
  return { name: 'finance-manager-local-server', configureServer: install, configurePreviewServer: server => { install(server); startAlerts() } }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), localServer(loadEnv(mode, process.cwd(), ''))],
  server: { host: "127.0.0.1", port: 5177, strictPort: true, watch: { usePolling: true } },
  preview: { host: "127.0.0.1", port: 5177, strictPort: true },
}))
