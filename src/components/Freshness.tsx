import type { DataPointMeta } from '../domain/models'

export function Freshness({ items }: { items: DataPointMeta[] }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">Data freshness</div>
          <h2>What this report is based on</h2>
        </div>
      </div>
      <div className="freshness-grid">
        {items.map((item) => (
          <div className="freshness-row" key={`${item.source}-${item.asOf}`}>
            <div>
              <strong>{item.source}</strong>
              <div className="muted">{new Date(item.asOf).toLocaleString()}</div>
            </div>
            <span className={`freshness freshness-${item.freshness}`}>{item.freshness}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
