import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles.css'
import { applyTheme, loadThemePref, resolveTheme } from './theme'

// Apply the theme before the first paint so there's no flash of the wrong colours.
applyTheme(resolveTheme(loadThemePref()))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
