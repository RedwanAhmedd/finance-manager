import Anthropic from '@anthropic-ai/sdk'
import { BRIEFING_REQUEST, SYSTEM_PROMPT, TRADE_REMINDER, isTradeQuestion, type AssistantRequest, type Turn } from './prompt.ts'

// A provider streams reply text and finally returns why it stopped:
// 'end_turn', 'max_tokens', 'refusal', or null when the model does not say.
export interface Provider {
  name: 'anthropic' | 'ollama'
  model: string
  local: boolean
  // null when ready; otherwise the setup step the owner still needs to take.
  check(): Promise<string | null>
  stream(request: AssistantRequest, signal: AbortSignal): AsyncGenerator<string, string | null>
}

const snapshotBlock = (request: AssistantRequest) => `<financial_snapshot>\n${request.context}\n</financial_snapshot>`
const conversation = (request: AssistantRequest): Turn[] => {
  if (request.mode === 'briefing') return [{ role: 'user', content: BRIEFING_REQUEST }]
  const last = request.messages[request.messages.length - 1]
  return isTradeQuestion(last.content, request.context)
    ? [...request.messages.slice(0, -1), { role: 'user', content: `${last.content}\n\n(${TRADE_REMINDER})` }]
    : request.messages
}

export const ANTHROPIC_MODEL = 'claude-opus-5'

export function anthropicParams(request: AssistantRequest): Anthropic.Beta.Messages.MessageCreateParamsStreaming {
  return {
    model: ANTHROPIC_MODEL,
    max_tokens: 16_000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    stream: true,
    system: [
      { type: 'text', text: SYSTEM_PROMPT },
      // The snapshot is identical across a conversation's turns, so cache it.
      { type: 'text', text: snapshotBlock(request), cache_control: { type: 'ephemeral' } },
    ],
    messages: conversation(request),
  }
}

export function anthropicProvider(apiKey: string | undefined): Provider {
  const key = apiKey?.trim() || undefined
  let client: Anthropic | null = null
  return {
    name: 'anthropic', model: ANTHROPIC_MODEL, local: false,
    async check() { return key ? null : 'Add ANTHROPIC_API_KEY to .env.local and restart npm run dev.' },
    async *stream(request, signal) {
      client ??= new Anthropic({ apiKey: key })
      const stream = client.beta.messages.stream(anthropicParams(request), { signal })
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield event.delta.text
      }
      return (await stream.finalMessage()).stop_reason
    },
  }
}

// Small local models have short context windows, and Ollama silently drops the
// oldest tokens (the instructions and figures) when a prompt overflows. Keep the
// system prompt and snapshot whole; drop the oldest question/answer pairs instead.
export function fitConversation(system: string, turns: Turn[], contextTokens: number): Turn[] {
  const tokens = (s: string) => Math.ceil(s.length / 3.5)
  const budget = contextTokens - 1_500 // room for the reply
  if (tokens(system) + tokens(BRIEFING_REQUEST) > budget) throw new ProviderError('The figures are too large for this local model\'s context window. Raise OLLAMA_NUM_CTX or use a model with a longer context.')
  const kept = [...turns]
  while (kept.length > 1 && tokens(system) + kept.reduce((s, t) => s + tokens(t.content), 0) > budget) kept.splice(0, 2)
  if (tokens(system) + kept.reduce((s, t) => s + tokens(t.content), 0) > budget) throw new ProviderError('That question is too long for the local model\'s context window.')
  return kept
}

export class ProviderError extends Error {}

export function ollamaProvider({ host = 'http://127.0.0.1:11434', model = 'qwen3:8b', numCtx = 16384, transport = fetch }: { host?: string; model?: string; numCtx?: number; transport?: typeof fetch }): Provider {
  const base = host.replace(/\/$/, '')
  return {
    name: 'ollama', model, local: true,
    async check() {
      try {
        const res = await transport(`${base}/api/tags`, { signal: AbortSignal.timeout(2_000) })
        const { models = [] } = await res.json() as { models?: { name: string }[] }
        const names = models.map(m => m.name)
        return names.includes(model) || names.includes(`${model}:latest`) ? null : `Ollama is running but "${model}" is not installed. Run: ollama pull ${model}`
      } catch {
        return `Ollama is not reachable at ${base}. Open the Ollama app or run: ollama serve`
      }
    },
    async *stream(request, signal) {
      const system = `${SYSTEM_PROMPT}\n\n${snapshotBlock(request)}`
      const messages = [{ role: 'system', content: system }, ...fitConversation(system, conversation(request), numCtx)]
      const res = await transport(`${base}/api/chat`, {
        method: 'POST', signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: true, options: { num_ctx: numCtx, temperature: 0.2 } }),
      }).catch(() => { throw new ProviderError(`Ollama is not reachable at ${base}.`) })
      if (!res.ok || !res.body) throw new ProviderError(`Ollama returned ${res.status}${res.status === 404 ? `; is "${model}" installed?` : ''}`)
      const decoder = new TextDecoder()
      let buffer = ''
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as { message?: { content?: string }; done?: boolean; done_reason?: string; error?: string }
          if (event.error) throw new ProviderError(`Ollama: ${event.error}`)
          if (event.message?.content) yield event.message.content
          if (event.done) return event.done_reason === 'length' ? 'max_tokens' : 'end_turn'
        }
      }
      throw new ProviderError('Ollama stopped before finishing.')
    },
  }
}

export function providerFromEnv(env: Record<string, string | undefined>): Provider {
  const choice = env.ASSISTANT_PROVIDER?.trim().toLowerCase() || (env.ANTHROPIC_API_KEY?.trim() ? 'anthropic' : 'ollama')
  if (choice === 'anthropic') return anthropicProvider(env.ANTHROPIC_API_KEY)
  if (choice === 'ollama') return ollamaProvider({ host: env.OLLAMA_HOST || undefined, model: env.OLLAMA_MODEL || undefined, numCtx: Number(env.OLLAMA_NUM_CTX) || undefined })
  throw new Error(`ASSISTANT_PROVIDER must be "anthropic" or "ollama", not "${choice}"`)
}
