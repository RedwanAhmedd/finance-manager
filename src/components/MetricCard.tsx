export function MetricCard({ label, value, note, tone = 'neutral', loading = false }: {
  label: string
  value: string
  note?: string
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
  loading?: boolean
}) {
  return (
    <article className={`metric metric-${tone}`} aria-busy={loading}>
      <div className="eyebrow">{label}</div>
      {loading ? <div className="metric-value skeleton" aria-label="Loading" /> : <div className="metric-value">{value}</div>}
      {note && <div className="metric-note">{note}</div>}
    </article>
  )
}
