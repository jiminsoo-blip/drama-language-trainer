import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'

// GitHub Pages serves the app under a repo-name subpath; Vite's BASE_URL
// carries that base into the router so routes match in prod and dev alike.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

// Offline-first PWA: service worker (production only). Check for updates on
// every load; when a new SW takes control, reload once so users are never
// stuck on a stale cached version.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  })
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((reg) => reg.update())
      .catch(() => {
        // offline caching is best-effort; the app works without it
      })
  })
}
