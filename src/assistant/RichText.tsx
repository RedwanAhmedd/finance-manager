import type { ReactNode } from 'react'

// Renders the small Markdown subset the assistant is told to use (### headings,
// "- " bullets, **bold**) as React elements. No HTML from the model is injected.
function inline(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => i % 2 ? <strong key={i}>{part}</strong> : part)
}

export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  const flush = () => {
    if (bullets.length) blocks.push(<ul key={blocks.length}>{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>)
    bullets = []
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const bullet = line.match(/^[-*•]\s+(.*)$/)
    if (bullet) { bullets.push(bullet[1]); continue }
    flush()
    if (!line) continue
    const heading = line.match(/^#{1,4}\s+(.*)$/)
    blocks.push(heading ? <h3 key={blocks.length}>{inline(heading[1])}</h3> : <p key={blocks.length}>{inline(line)}</p>)
  }
  flush()
  return <div className="rich-text">{blocks}</div>
}
