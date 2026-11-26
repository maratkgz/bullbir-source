import { useCallback, useRef, useState } from 'react'
import { readPendingEmail, writePendingEmail } from './session'

// Sign-up in progress: the address waiting for its code (sessionStorage) and the registration
// password + name, kept in memory only (never in storage): verify-email and resend need them again.
export function useRegistrationDraft() {
  const [pendingEmail, setPendingEmailState] = useState(readPendingEmail)
  const [hasRegistrationPassword, setHasRegistrationPassword] = useState(false)
  const passwordRef = useRef(null)
  const nameRef = useRef(null)

  const setPendingEmail = useCallback((email) => {
    writePendingEmail(email)
    setPendingEmailState(email)
  }, [])

  const setRegistrationPassword = useCallback((password, name = null) => {
    passwordRef.current = password || null
    nameRef.current = password ? name || null : null
    setHasRegistrationPassword(!!password)
  }, [])

  const clearDraft = useCallback(() => {
    setRegistrationPassword(null)
    setPendingEmail(null)
  }, [setPendingEmail, setRegistrationPassword])

  return {
    pendingEmail,
    hasRegistrationPassword,
    passwordRef,
    nameRef,
    setPendingEmail,
    setRegistrationPassword,
    clearDraft,
  }
}
