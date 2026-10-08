import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

function Hello() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32, maxWidth: 720 }}>
      <h1 style={{ color: '#c9a227', letterSpacing: 2 }}>WarMechForge</h1>
      <p>A turn-based hex 'Mech battle game against an AI. Under construction.</p>
      <p style={{ opacity: 0.6, fontSize: 13 }}>
        Unofficial fan project. Not affiliated with or endorsed by Catalyst Game Labs, Topps or Microsoft.
        BattleTech and 'Mech names are trademarks of their respective owners. Free and non-commercial.
      </p>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Hello />
  </StrictMode>,
)
