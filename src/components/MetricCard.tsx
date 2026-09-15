export function MetricCard({ label, value, note, tone = 'neutral' }: {
  label: string
  value: string
  note?: string
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
}) {
  return (
    <article className={`metric metric-${tone}`}>
      <div className="eyebrow">{label}</div>
      <div className="metric-value">{value}</div>
      {note && <div className="metric-note">{note}</div>}
    </article>
  )
}
