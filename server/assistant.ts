import type { IncomingMessage, ServerResponse } from 'node:http'
import { writeFile } from 'node:fs/promises'
import Anthropic from '@anthropic-ai/sdk'
import { parseRequest, RequestError, type AssistantRequest } from './prompt.ts'
import { ProviderError, type Provider } from './providers.ts'

// Local-only AI endpoint. Provider credentials stay in this Node process; the
// browser sends the already-normalized snapshot and receives streamed text.
const MAX_BODY_BYTES = 300_000

function errorText(error: unknown): string {
  if (error instanceof RequestError || error instanceof ProviderError) return error.message
  if (error instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.local.'
  if (error instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use the model.'
  if (error instanceof Anthropic.RateLimitError) return 'Rate limited by the Anthropic API. Wait a moment and try again.'
  if (error instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API. Check your internet connection.'
  if (error instanceof Anthropic.APIError) return `Anthropic API error ${error.status ?? ''}`.trim()
  return 'The assistant failed unexpectedly.'
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new RequestError('Request is too large')
    chunks.push(chunk as Buffer)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new RequestError('Request body is not valid JSON') }
}

// Only this app's own page may use the assistant. A cross-site page cannot send
// application/json without a CORS preflight, which this handler never grants.
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  return !origin || origin === `http://${req.headers.host}`
}

// saveContextTo (development only) writes the latest document the model was given,
// so its understanding can be tested against the source database.
export function createAssistantHandler(provider: Provider, { saveContextTo }: { saveContextTo?: string } = {}) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split('?')[0]
    if (path !== '/api/assistant' && path !== '/api/assistant/status') return next()
    const json = (status: number, body: unknown) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)) }
    if (!sameOrigin(req)) return json(403, { error: 'Cross-origin requests are not allowed' })
    if (path === '/api/assistant/status') {
      if (req.method !== 'GET') return json(405, { error: 'GET only' })
      const setup = await provider.check()
      return json(200, { provider: provider.name, model: provider.model, local: provider.local, ready: !setup, setup })
    }
    if (req.method !== 'POST') return json(405, { error: 'POST only' })
    if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'Send application/json' })

    let request: AssistantRequest
    try { request = parseRequest(await readBody(req)) } catch (error) { return json(400, { error: errorText(error) }) }
    if (saveContextTo) await writeFile(saveContextTo, request.context).catch(() => {})
    const setup = await provider.check()
    if (setup) return json(503, { error: setup })

    // Newline-delimited JSON: {"text"} chunks, then one {"done"} or {"error"}.
    res.statusCode = 200
    res.setHeader('content-type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    const send = (event: object) => res.write(`${JSON.stringify(event)}\n`)
    const controller = new AbortController()
    res.on('close', () => { if (!res.writableEnded) controller.abort() })
    try {
      const stream = provider.stream(request, controller.signal)
      for (;;) {
        const step = await stream.next()
        if (step.done) { send({ done: true, stop: step.value }); break }
        send({ text: step.value })
      }
    } catch (error) {
      if (!controller.signal.aborted) send({ error: errorText(error) })
    }
    res.end()
  }
}
