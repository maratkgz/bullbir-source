import { useState, useEffect, useCallback } from 'react'

const isIOS = () =>
  typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)

const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true)

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [installed, setInstalled] = useState(isStandalone())
  const [showIosHint, setShowIosHint] = useState(false)

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferredPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)

    if (isIOS() && !isStandalone()) {
      const seen = window.localStorage.getItem('bullbir_ios_install_hint')
      if (!seen) setShowIosHint(true)
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    setDeferredPrompt(null)
    if (outcome === 'accepted') setInstalled(true)
    return outcome === 'accepted'
  }, [deferredPrompt])

  const dismissIosHint = useCallback(() => {
    window.localStorage.setItem('bullbir_ios_install_hint', '1')
    setShowIosHint(false)
  }, [])

  return {
    canInstall: !!deferredPrompt && !installed,
    installed,
    isIOS: isIOS(),
    showIosHint,
    promptInstall,
    dismissIosHint,
  }
}
