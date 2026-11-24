import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db, firebaseReady } from '../firebase/config'
import { useAuth } from '../context/AuthContext'
import { BUILTIN_DOMAINS, BUILTIN_INTENTS } from './library'
import { validateDomain, validateIntent } from './library/schema'

export const AI_DOMAINS_COLLECTION = 'aiDomains'
export const AI_INTENTS_COLLECTION = 'aiIntents'

function useAdminEntries(name) {
  const { user, isVerified } = useAuth()
  const [entries, setEntries] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!firebaseReady || !user || !isVerified) return undefined
    return onSnapshot(
      collection(db, name),
      (snap) => { setEntries(snap.docs.map((d) => ({ ...d.data(), id: d.id }))); setError(null) },
      (err) => setError(err), // offline/denied → built-in library still works
    )
  }, [name, user, isVerified])

  return { entries, error }
}

/**
 * Merges admin entries over the built-in ones. An entry with `disabled: true` hides the
 * built-in item with the same id. Invalid entries are skipped (never shown to users).
 */
function merge(builtin, custom, validate) {
  const byId = new Map(builtin.map((b) => [b.id, { ...b, source: 'builtin' }]))
  const rejected = []
  custom.forEach((c) => {
    if (c.disabled) { byId.delete(c.id); return }
    const problems = validate(c)
    if (problems.length) { rejected.push({ id: c.id, problems }); return }
    byId.set(c.id, { ...c, source: byId.has(c.id) ? 'override' : 'custom' })
  })
  return { items: [...byId.values()], rejected }
}

/** Knowledge library for the assistant: built-in files + Firestore admin edits. */
export function useAiLibrary() {
  const domainsRemote = useAdminEntries(AI_DOMAINS_COLLECTION)
  const intentsRemote = useAdminEntries(AI_INTENTS_COLLECTION)

  return useMemo(() => {
    const domains = merge(BUILTIN_DOMAINS, domainsRemote.entries, validateDomain)
    const intents = merge(BUILTIN_INTENTS, intentsRemote.entries, validateIntent)
    return {
      domains: domains.items,
      intents: intents.items,
      rejected: [...domains.rejected, ...intents.rejected],
      remoteDomains: domainsRemote.entries,
      remoteIntents: intentsRemote.entries,
    }
  }, [domainsRemote.entries, intentsRemote.entries])
}
