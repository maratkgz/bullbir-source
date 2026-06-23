import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { inject as injectAnalytics } from '@vercel/analytics'

import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { LangProvider } from './context/LangContext'
import { ToastProvider } from './components/ui/Toast'
import App from './App'
import './styles/global.css'

// Auto-update the service worker without forcing a reload.
registerSW({ immediate: true })

injectAnalytics()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LangProvider>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </LangProvider>
  </StrictMode>,
)
