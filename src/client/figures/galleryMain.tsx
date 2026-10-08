// Stand-alone entry for reviewing the gallery without the game shell (dev only; the app reaches the gallery with ?gallery).
import { createRoot } from 'react-dom/client'
import Gallery from './Gallery'

createRoot(document.getElementById('root')!).render(<Gallery />)
