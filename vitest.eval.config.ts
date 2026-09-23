import { defineConfig } from 'vitest/config'

// The assistant eval talks to the real sources and a real model, so it is kept
// out of `npm test` and run on demand with `npm run eval`.
export default defineConfig({
  test: { include: ['eval/**/*.eval.ts'], testTimeout: 600_000, hookTimeout: 120_000, reporters: ['verbose'] },
})
