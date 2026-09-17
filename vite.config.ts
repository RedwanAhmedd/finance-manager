import { defineConfig, loadEnv, type Plugin } from 'vite'
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
  const assistantHandler = createAssistantHandler(providerFromEnv(env), { saveContextTo: env.ASSISTANT_SAVE_CONTEXT || undefined })
  const sourcesHandler = createSourcesHandler(sourcesFromEnv(env))
  const fxHandler = createFxHandler(createFxSource())
  const moneyHandler = createMoneyHandler(moneyStoreFromEnv(env))
  return {
    name: 'finance-manager-local-server',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void moneyHandler(req, res, () => void fxHandler(req, res, () => void sourcesHandler(req, res, () => void assistantHandler(req, res, next)))))
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void moneyHandler(req, res, () => void fxHandler(req, res, () => void sourcesHandler(req, res, () => void assistantHandler(req, res, next)))))
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), localServer(loadEnv(mode, process.cwd(), ''))],
  server: { host: "127.0.0.1", port: 5177, strictPort: true, watch: { usePolling: true } },
  preview: { host: "127.0.0.1", port: 5177, strictPort: true },
}))
