import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'

import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { LangProvider } from './context/LangContext'
import { ToastProvider } from './components/ui/Toast'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { installGlobalErrorReporting } from './monitoring/reportError'
import './styles/global.css'

// Auto-update the service worker without forcing a reload.
registerSW({ immediate: true })

// Crash reports from users' devices go to the server logs (no user content).
installGlobalErrorReporting()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LangProvider>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </LangProvider>
  </StrictMode>,
)
