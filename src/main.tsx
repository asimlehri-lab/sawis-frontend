import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Phase 6 (browser push) needs a registered service worker before any
// device can subscribe -- register it once, unconditionally, at startup.
// This alone does NOT ask for notification permission or create a
// subscription -- it's inert until a user opts in via Settings' own
// notification panel (see PushNotificationToggle in Settings.tsx).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
