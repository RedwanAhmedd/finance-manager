export function StatusPill({ status }: { status: 'healthy' | 'watch' | 'attention' }) {
  const label = status === 'healthy' ? 'Healthy' : status === 'watch' ? 'Watch' : 'Attention'
  return <span className={`status status-${status}`}>{label}</span>
}
