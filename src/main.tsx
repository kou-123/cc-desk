import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './ErrorBoundary'
import { applyFontScale, readFontPx, readFontScale } from './fontScale'
import { applyTheme, readTheme } from './theme'
import './styles.css'

applyTheme(readTheme())
applyFontScale(readFontScale(), readFontPx())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
