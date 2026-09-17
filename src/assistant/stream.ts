export type Turn = { role: 'user' | 'assistant'; content: string }
export type StreamEnd = { stop: string | null }

// Reads the local endpoint's newline-delimited JSON and reports text as it arrives.
export async function streamAssistant(
  body: { mode: 'briefing' | 'chat'; context: string; messages?: Turn[] },
  onText: (text: string) => void,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<StreamEnd> {
  const res = await transport('/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => null) as { error?: string } | null
    throw new Error(detail?.error ?? `Assistant request failed (${res.status})`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line) as { text?: string; done?: boolean; stop?: string | null; error?: string }
      if (event.error) throw new Error(event.error)
      if (event.text) onText(event.text)
      if (event.done) return { stop: event.stop ?? null }
    }
    if (done) throw new Error('The assistant stopped before finishing. Try again.')
  }
}

export function endNote(end: StreamEnd): string | null {
  if (end.stop === 'refusal') return 'The assistant declined to answer this one.'
  if (end.stop === 'max_tokens') return 'This answer was cut off because it ran too long.'
  return null
}
