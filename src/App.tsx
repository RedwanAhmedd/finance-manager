import { useState } from 'react'
import LiveDashboard from './live/LiveDashboard'

// One page for both: the owner's real finances, or the same page on sample data.
export default function App() {
  const [demo, setDemo] = useState(import.meta.env.VITE_DATA_MODE === 'demo')
  return <LiveDashboard key={demo ? 'demo' : 'live'} demo={demo} onToggleDemo={() => setDemo(d => !d)} />
}
